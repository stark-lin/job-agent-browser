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

  assert.deepEqual(await f.api.applications.deleteEvent({ id: event.id }), { ok: false, error: 'INVALID_STATE' })
})

test('profiles enforce same-profile references, cycle prevention and fact editing', async (t) => {
  const f = await seed(t), other = value(await f.api.profiles.createProfile({ name: 'Other' }))
  assert.deepEqual(await f.api.profiles.addFact({ profileId: other.id, profileItemId: f.item.id, details: { kind: 'SKILL', content: 'SQL' } }), { ok: false, error: 'CONFLICT' })
  const child = value(await f.api.profiles.addItem({ profileId: f.profile.id, parentItemId: f.item.id, details: { type: 'PROJECT', title: 'Nested' } }))
  assert.deepEqual(await f.api.profiles.moveItem({ id: f.item.id, parentItemId: child.id, sortOrder: 0 }), { ok: false, error: 'CONFLICT' })
  assert.deepEqual(await f.api.profiles.moveItem({ id: child.id, parentItemId: randomUUID(), sortOrder: 0 }), { ok: false, error: 'NOT_FOUND' })
  assert.equal(value(await f.api.profiles.editFact({ id: f.fact.id, details: { kind: 'ACHIEVEMENT', content: 'Revised' } })).content, 'Revised')
})

test('delete source entities completely but preserve generated results and missing references', async (t) => {
  const f = await published(t)
  value(await f.api.jobs.deleteJob({ id: f.job.id }))
  value(await f.api.profiles.deleteProfile({ id: f.profile.id }))
  assert.equal(value(await f.api.jobs.listJobs({})).total, 0)
  assert.equal(value(await f.api.profiles.listProfiles({})).total, 0)
  const view = value(await f.api.resumes.getArtifact({ id: f.artifact.id }))
  assert.equal(view.artifact.content.experience[0].bullets[0].text, 'PRIVATE_RESUME_BODY')
  assert.equal(view.references.every((ref) => ref.status === 'MISSING'), true)
  assert.equal(view.provenance[0].factIds[0], f.fact.id)
  const removed = ['jobs', 'job_sources', 'job_events', 'profiles', 'profile_items', 'facts']
  for (const table of removed) assert.equal(f.database.connection.prepare(`SELECT count(*) count FROM ${table}`).get()?.count, 0)
})

test('artifact content and provenance edits are validated together and invalidate output file references', async (t) => {
  const f = await published(t)
  f.backend.generation.recordOutputFiles({ id: f.artifact.id, files: [{ format: 'PDF', relativePath: 'resume.pdf' }] })
  const changed = structuredClone(f.content)
  Object.assign(changed.experience[0].bullets[0], { text: 'Manual text', factIds: [randomUUID()] })
  const edited = value(await f.api.resumes.editArtifact({ id: f.artifact.id, title: 'Edited', expectedRevision: 1, content: changed }))
  assert.equal(edited.revision, 2)
  assert.deepEqual(edited.content.experience[0].bullets[0].factIds, [])
  assert.equal(edited.outputFiles.length, 0)
  assert.deepEqual(value(await f.api.resumes.getArtifact({ id: f.artifact.id })).provenance, [])
  assert.deepEqual(await f.api.resumes.editArtifact({ id: f.artifact.id, title: 'Stale', expectedRevision: 1, content: f.content }), { ok: false, error: 'CONFLICT' })
  assert.equal(value(await f.api.profiles.listFacts({ profileId: f.profile.id })).items[0].content, f.fact.content)
  assert.throws(() => f.backend.generation.recordOutputFiles({ id: f.artifact.id, files: [{ format: 'PDF', relativePath: '../outside.pdf' }] }), { code: 'INVALID_INPUT' })
})

test('generation snapshot is immutable, stage ordering is enforced and duplicate artifacts are rejected', async (t) => {
  const f = await published(t)
  assert.equal(f.backend.generation.publishArtifact({ runId: f.run.id }).id, f.artifact.id)
  assert.throws(() => f.database.transactions.write(() => {
    f.database.connection.prepare('UPDATE generation_runs SET input_snapshot_json=? WHERE id=?').run('{}', f.run.id)
  }), { code: 'CONFLICT' })
  value(await f.api.resumes.deleteRun({ id: f.run.id }))
  assert.deepEqual(await f.api.resumes.getArtifact({ id: f.artifact.id }), { ok: false, error: 'NOT_FOUND' })
})

test('human resume edits accept display text and empty statements while malformed payloads remain rejected', async t => {
  const f = await published(t), content = structuredClone(f.content)
  content.basics.links = [{ label: '', url: 'my-portfolio.example' }]
  Object.assign(content.experience[0], { startDate: '2025 年秋季学期', endDate: '待定', isCurrent: true, url: '个人项目，暂无链接' })
  content.experience[0].bullets[0].text = ''
  const input = { id: f.artifact.id, title: f.artifact.title, expectedRevision: 1, content }
  const edited = value(await f.api.resumes.editArtifact(input))
  assert.equal(edited.content.experience[0].startDate, content.experience[0].startDate)
  assert.equal(edited.content.experience[0].endDate, '待定')
  assert.equal(edited.content.experience[0].bullets[0].text, '')
  assert.deepEqual(edited.content.experience[0].bullets[0].factIds, [])
  assert.deepEqual(edited.content.basics.links, content.basics.links)
  for (const malformed of [
    { ...content, basics: { ...content.basics, phone: 123 } },
    { ...content, skills: 'invalid array' },
    { ...content, unexpected: true }
  ]) {
    assert.deepEqual(await f.backend.dispatch('resumes', 'editArtifact', { ...input, expectedRevision: 2, content: malformed }), { ok: false, error: 'INVALID_INPUT' })
  }
  assert.deepEqual(value(await f.api.resumes.getArtifact({ id: f.artifact.id })).artifact, edited)
  const omitted = { ...content, basics: { ...content.basics, links: [{}] },
    experience: content.experience.map(({ url: _url, ...entry }) => entry) }
  const saved = await f.backend.dispatch('resumes', 'editArtifact', { ...input, expectedRevision: 2, content: omitted })
  assert.equal(saved.ok, true)
  const latest = value(await f.api.resumes.getArtifact({ id: f.artifact.id })).artifact
  assert.deepEqual(latest.content.basics.links, [{ label: '', url: '' }])
  assert.equal(latest.content.experience[0].url, '')
})

test('calendar validates ranges and company deletion detaches jobs', async (t) => {
  const f = fixture(t), company = value(await f.api.jobs.registerCompany({ name: 'Company' }))
  const job = value(await f.api.jobs.saveJob({ details: { title: 'Role', companyNameRaw: 'Company', companyId: company.id } }))
  const scheduled = value(await f.api.applications.scheduleEvent({ jobId: job.id, type: 'INTERVIEW', title: 'Interview', startsAt: '2026-10-03T10:00:00.000Z', endsAt: '2026-10-03T11:00:00.000Z' }))
  assert.equal(value(await f.api.applications.listCalendar({ from: '2026-10-03T00:00:00.000Z', to: '2026-10-04T00:00:00.000Z' })).items[0].id, scheduled.id)
  assert.deepEqual(await f.api.applications.rescheduleEvent({ id: scheduled.id, startsAt: '2026-10-04T10:00:00.000Z', endsAt: '2026-10-03T11:00:00.000Z' }), { ok: false, error: 'INVALID_INPUT' })
  value(await f.api.jobs.deleteCompany({ id: company.id }))
  assert.equal(value(await f.api.jobs.getJob({ id: job.id })).companyId, null)
  assert.equal(value(await f.api.jobs.getJob({ id: job.id })).companyNameRaw, 'Company')
})

test('normalized optional URL fields can round-trip through business editors', async (t) => {
  const f = await seed(t), company = value(await f.api.jobs.registerCompany({ name: 'Company' }))
  assert.equal(value(await f.api.jobs.updateCompany({ id: company.id, details: { name: company.name, domain: company.domain, website: company.website, logoUrl: company.logoUrl } })).website, '')
  const { id, profileId: _profile, parentItemId: _parent, ...details } = f.item
  assert.equal(value(await f.api.profiles.editItem({ id, details })).title, f.item.title)
})

test('history list annotates missing source and company references just like detail queries', async (t) => {
  const f = await seed(t), company = value(await f.api.jobs.registerCompany({ name: 'Historical company' }))
  value(await f.api.jobs.updateDetails({ id: f.job.id, details: { title: f.job.title, companyNameRaw: f.job.companyNameRaw, companyId: company.id } }))
  const run = value(await f.api.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id }))
  value(await f.api.jobs.deleteCompany({ id: company.id }))
  value(await f.api.jobs.deleteJob({ id: f.job.id }))
  const list = value(await f.api.resumes.listRuns({ jobId: f.job.id }))
  assert.equal(list.items[0].run.id, run.id)
  for (const id of [company.id, f.job.id]) {
    assert.equal(list.items[0].references.find((reference) => reference.id === id)?.status, 'MISSING')
  }
})
