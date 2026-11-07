import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { openDatabase } from '../src/platform/database/sqlite'
import { composeBackend } from '../src/platform/database/backend'
import { createDataBridge } from '../src/platform/electron/preload/data-bridge'
import type { Result } from '../src/shared/ipc'

export function fixture(t: Pick<TestContext, 'after'>, path = ':memory:') {
  const database = openDatabase(path), backend = composeBackend(database)
  const api = createDataBridge(async (group, method, input) => backend.dispatch(group, method, input))
  t.after(() => { if (database.connection.isOpen) backend.close() })
  return { database, backend, api }
}

export function value<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(result.error)
  return result.value
}

export async function seed(t: Pick<TestContext, 'after'>, path = ':memory:') {
  const f = fixture(t, path)
  const job = value(await f.api.jobs.saveJob({ details: { title: 'PRIVATE_JOB_TITLE', companyNameRaw: 'PRIVATE_COMPANY' }, source: { url: 'https://example.com/job', cleanedContent: 'PRIVATE_JOB_BODY' } }))
  const profile = value(await f.api.profiles.createProfile({ name: 'PRIVATE_PERSON', email: 'private@example.com' }))
  const item = value(await f.api.profiles.addItem({ profileId: profile.id, details: { type: 'EXPERIENCE', title: 'PRIVATE_EXPERIENCE' } }))
  const fact = value(await f.api.profiles.addFact({ profileId: profile.id, profileItemId: item.id, details: { kind: 'ACHIEVEMENT', content: 'PRIVATE_FACT_BODY' } }))
  return { ...f, job, profile, item, fact }
}

export async function published(t: Pick<TestContext, 'after'>, path = ':memory:') {
  const f = await seed(t, path)
  const run = f.backend.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id }, { start: true })
  f.backend.generation.rewriteBullet({ runId: run.id, bulletId: run.assembled!.experience[0].bullets[0].id,
    text: 'PRIVATE_RESUME_BODY', requestId: randomUUID() })
  f.backend.generation.beginValidation(run.id)
  f.backend.generation.preparePublication(run.id)
  const artifact = f.backend.generation.publishArtifact({ runId: run.id })
  const content = artifact.content
  const provenance = [{ blockId: content.experience[0].bullets[0].id, factIds: [f.fact.id] }]
  return { ...f, run, artifact, content, provenance }
}
