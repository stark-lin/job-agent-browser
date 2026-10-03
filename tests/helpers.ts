import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../src/platform/database/sqlite'
import { composeBackend } from '../src/platform/database/backend'
import { createDataBridge } from '../src/platform/electron/preload/data-bridge'
import type { Result } from '../src/shared/ipc'

export function fixture(t: TestContext, path = ':memory:') {
  const database = openDatabase(path), backend = composeBackend(database)
  const api = createDataBridge(async (group, method, input) => backend.dispatch(group, method, input))
  t.after(() => { if (database.connection.isOpen) backend.close() })
  return { database, backend, api }
}

export function value<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(result.error)
  return result.value
}

export async function seed(t: TestContext) {
  const f = fixture(t)
  const job = value(await f.api.jobs.saveJob({ details: { title: 'PRIVATE_JOB_TITLE', companyNameRaw: 'PRIVATE_COMPANY' }, source: { url: 'https://example.com/job', cleanedContent: 'PRIVATE_JOB_BODY' } }))
  const profile = value(await f.api.profiles.createProfile({ name: 'PRIVATE_PERSON', email: 'private@example.com' }))
  const item = value(await f.api.profiles.addItem({ profileId: profile.id, details: { type: 'EXPERIENCE', title: 'PRIVATE_EXPERIENCE' } }))
  const fact = value(await f.api.profiles.addFact({ profileId: profile.id, profileItemId: item.id, details: { kind: 'ACHIEVEMENT', content: 'PRIVATE_FACT_BODY' } }))
  return { ...f, job, profile, item, fact }
}

export async function published(t: TestContext) {
  const f = await seed(t), run = value(await f.api.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id, factIds: [f.fact.id] }))
  const blockId = randomUUID()
  const content = { schemaVersion: 1 as const, header: { name: 'PRIVATE_PERSON', email: '', phone: '', location: '', links: [] },
    summary: { id: blockId, text: 'PRIVATE_RESUME_BODY' }, sections: [] }
  f.backend.generation.start({ id: run.id })
  f.backend.generation.recordScores({ id: run.id, scores: [{ factId: f.fact.id, score: 95, reason: 'PRIVATE_SCORE_REASON' }] })
  f.backend.generation.recordGate({ id: run.id, gate: { passed: true, reason: '', missingRequirements: [] } })
  f.backend.generation.selectEvidence({ id: run.id, selection: { factIds: [f.fact.id], itemIds: [f.item.id], wordBudget: 500 } })
  f.backend.generation.saveDraft({ id: run.id, content })
  f.backend.generation.savePolished({ id: run.id, content })
  const provenance = [{ blockId, factIds: [f.fact.id] }]
  const artifact = f.backend.generation.publishArtifact({ id: run.id, title: 'PRIVATE_ARTIFACT_TITLE', provenance })
  return { ...f, run, artifact, content, provenance }
}
