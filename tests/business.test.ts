import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture, seed, published, value } from './helpers'

test('application transitions update job and event atomically and forbid arbitrary jumps', async (t) => {
  const f = await seed(t)
  assert.deepEqual(await f.api.applications.changeStatus({ jobId: f.job.id, status: 'ACCEPTED' }), { ok: false, error: 'INVALID_STATE' })
  const job = value(await f.api.applications.changeStatus({ jobId: f.job.id, status: 'APPLIED' }))
  assert.ok(job.appliedAt)
  const event = value(await f.api.applications.listEvents({ jobId: job.id })).items[0]
  assert.equal(event.type, 'APPLICATION_SUBMITTED')
  const entries = value(await f.api.audit.list({})).items.filter((e) => e.eventType === 'APPLICATION_STATUS_CHANGE' && e.status === 'SUCCESS')
  assert.equal(entries.length, 2)
  assert.equal(entries[0].transactionId, entries[1].transactionId)
  assert.deepEqual(await f.api.applications.deleteEvent({ id: event.id }), { ok: false, error: 'INVALID_STATE' })
})

test('profiles enforce same-profile references, cycle prevention and confirmation invalidation', async (t) => {
  const f = await seed(t), other = value(await f.api.profiles.createProfile({ name: 'Other' }))
  assert.deepEqual(await f.api.profiles.addFact({ profileId: other.id, profileItemId: f.item.id, details: { kind: 'SKILL', content: 'SQL' } }), { ok: false, error: 'CONFLICT' })
  const child = value(await f.api.profiles.addItem({ profileId: f.profile.id, parentItemId: f.item.id, details: { type: 'PROJECT', title: 'Nested' } }))
  assert.deepEqual(await f.api.profiles.moveItem({ id: f.item.id, parentItemId: child.id, sortOrder: 0 }), { ok: false, error: 'CONFLICT' })
  assert.deepEqual(await f.api.profiles.moveItem({ id: child.id, parentItemId: randomUUID(), sortOrder: 0 }), { ok: false, error: 'NOT_FOUND' })
  assert.equal(value(await f.api.profiles.confirmFact({ id: f.fact.id })).verificationStatus, 'CONFIRMED')
  assert.equal(value(await f.api.profiles.editFact({ id: f.fact.id, details: { kind: 'ACHIEVEMENT', content: 'Revised' } })).verificationStatus, 'UNVERIFIED')
})

test('delete source entities completely but preserve generated results and deleted reference markers', async (t) => {
  const f = await published(t)
  value(await f.api.jobs.deleteJob({ id: f.job.id }))
  value(await f.api.profiles.deleteProfile({ id: f.profile.id }))
  assert.equal(value(await f.api.jobs.listJobs({})).total, 0)
  assert.equal(value(await f.api.profiles.listProfiles({})).total, 0)
  const view = value(await f.api.resumes.getArtifact({ id: f.artifact.id }))
  assert.equal(view.artifact.content.summary?.text, 'PRIVATE_RESUME_BODY')
  assert.equal(view.references.every((ref) => ref.status === 'DELETED' && ref.deletedAt), true)
  assert.equal(view.provenance[0].factIds[0], f.fact.id)
  const removed = ['jobs', 'job_sources', 'job_events', 'profiles', 'profile_items', 'facts']
  for (const table of removed) assert.equal(f.database.connection.prepare(`SELECT count(*) count FROM ${table}`).get()?.count, 0)
  const deleted = value(await f.api.audit.list({ limit: 100 })).items.filter((e) => e.action === 'DELETE' && e.status === 'SUCCESS')
  for (const id of [f.job.id, f.profile.id, f.item.id, f.fact.id]) assert.ok(deleted.some((e) => e.targetId === id))
})

test('artifact content and provenance edits are validated together and invalidate output file references', async (t) => {
  const f = await published(t)
  f.backend.generation.recordOutputFiles({ id: f.artifact.id, files: [{ format: 'PDF', relativePath: 'resume.pdf' }] })
  assert.deepEqual(await f.api.resumes.editArtifact({ id: f.artifact.id, title: 'Edit', content: f.content, provenance: [{ blockId: randomUUID(), factIds: [f.fact.id] }] }), { ok: false, error: 'CONFLICT' })
  assert.equal(value(await f.api.resumes.getArtifact({ id: f.artifact.id })).artifact.outputFiles.length, 1)
  const edited = value(await f.api.resumes.editArtifact({ id: f.artifact.id, title: 'Edited', content: f.content, provenance: f.provenance }))
  assert.equal(edited.outputFiles.length, 0)
  assert.throws(() => f.backend.generation.recordOutputFiles({ id: f.artifact.id, files: [{ format: 'PDF', relativePath: '../outside.pdf' }] }), { code: 'INVALID_INPUT' })
})

test('generation snapshot is immutable, stage ordering is enforced and duplicate artifacts are rejected', async (t) => {
  const f = await published(t)
  assert.throws(() => f.backend.generation.publishArtifact({ id: f.run.id, title: 'Second', provenance: f.provenance }), { code: 'INVALID_STATE' })
  assert.throws(() => f.database.transactions.forActor('AI').write({ event: 'GENERATION_SCORE', action: 'UPDATE', target: 'generation_run' }, () => {
    f.database.connection.prepare('UPDATE generation_runs SET input_snapshot_json=? WHERE id=?').run('{}', f.run.id)
  }), { code: 'CONFLICT' })
  value(await f.api.resumes.deleteRun({ id: f.run.id }))
  assert.deepEqual(await f.api.resumes.getArtifact({ id: f.artifact.id }), { ok: false, error: 'NOT_FOUND' })
  assert.ok(value(await f.api.audit.list({ targetId: f.artifact.id })).items.some((e) => e.action === 'DELETE'))
})

test('calendar validates ranges and company deletion detaches jobs with audit', async (t) => {
  const f = fixture(t), company = value(await f.api.jobs.registerCompany({ name: 'Company' }))
  const job = value(await f.api.jobs.saveJob({ details: { title: 'Role', companyNameRaw: 'Company', companyId: company.id } }))
  const scheduled = value(await f.api.applications.scheduleEvent({ jobId: job.id, type: 'INTERVIEW', title: 'Interview', startsAt: '2026-10-03T10:00:00.000Z', endsAt: '2026-10-03T11:00:00.000Z' }))
  assert.equal(value(await f.api.applications.listCalendar({ from: '2026-10-03T00:00:00.000Z', to: '2026-10-04T00:00:00.000Z' })).items[0].id, scheduled.id)
  assert.deepEqual(await f.api.applications.rescheduleEvent({ id: scheduled.id, startsAt: '2026-10-04T10:00:00.000Z', endsAt: '2026-10-03T11:00:00.000Z' }), { ok: false, error: 'INVALID_INPUT' })
  value(await f.api.jobs.deleteCompany({ id: company.id }))
  assert.equal(value(await f.api.jobs.getJob({ id: job.id })).companyId, null)
  assert.equal(value(await f.api.jobs.getJob({ id: job.id })).companyNameRaw, 'Company')
  const entries = value(await f.api.audit.list({})).items.filter((e) => e.eventType === 'COMPANY_DELETE')
  assert.equal(entries.length, 2)
})

test('normalized optional URL fields can round-trip through business editors', async (t) => {
  const f = await seed(t), company = value(await f.api.jobs.registerCompany({ name: 'Company' }))
  assert.equal(value(await f.api.jobs.updateCompany({ id: company.id, details: { name: company.name, domain: company.domain, website: company.website, logoUrl: company.logoUrl } })).website, '')
  const { id, profileId: _profile, parentItemId: _parent, ...details } = f.item
  assert.equal(value(await f.api.profiles.editItem({ id, details })).title, f.item.title)
})

test('empty resume and unselected evidence are rejected; rejected gate stops generation', async (t) => {
  const f = await published(t)
  assert.deepEqual(await f.api.resumes.editArtifact({ id: f.artifact.id, title: 'Empty', content: { ...f.content, summary: null }, provenance: [] }), { ok: false, error: 'CONFLICT' })
  assert.deepEqual(await f.api.resumes.editArtifact({ id: f.artifact.id, title: 'Foreign', content: f.content, provenance: [{ blockId: f.content.summary.id, factIds: [randomUUID()] }] }), { ok: false, error: 'CONFLICT' })
  const run = value(await f.api.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id, factIds: [f.fact.id] }))
  f.backend.generation.start({ id: run.id })
  assert.throws(() => f.backend.generation.recordGate({ id: run.id, gate: { passed: true, reason: '', missingRequirements: [] } }), { code: 'INVALID_STATE' })
  f.backend.generation.recordScores({ id: run.id, scores: [{ factId: f.fact.id, score: 0, reason: '' }] })
  f.backend.generation.recordGate({ id: run.id, gate: { passed: false, reason: 'Missing evidence', missingRequirements: ['Skill'] } })
  assert.equal(value(await f.api.resumes.getRun({ id: run.id })).run.status, 'FAILED')
  assert.throws(() => f.backend.generation.selectEvidence({ id: run.id, selection: { factIds: [f.fact.id], itemIds: [], wordBudget: 500 } }), { code: 'INVALID_STATE' })
})

test('history list annotates deleted source and company references just like detail queries', async (t) => {
  const f = await seed(t), company = value(await f.api.jobs.registerCompany({ name: 'Historical company' }))
  value(await f.api.jobs.updateDetails({ id: f.job.id, details: { title: f.job.title, companyNameRaw: f.job.companyNameRaw, companyId: company.id } }))
  const run = value(await f.api.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id, factIds: [f.fact.id] }))
  value(await f.api.jobs.deleteCompany({ id: company.id }))
  value(await f.api.jobs.deleteJob({ id: f.job.id }))
  const list = value(await f.api.resumes.listRuns({ jobId: f.job.id }))
  assert.equal(list.items[0].run.id, run.id)
  for (const id of [company.id, f.job.id]) {
    assert.equal(list.items[0].references.find((reference) => reference.id === id)?.status, 'DELETED')
  }
})
