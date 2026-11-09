import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture, seed, value } from './helpers'
import { DataError } from '../src/domain/common/errors'

test('multi-row business save commits job and source together', async t => {
  const { api } = fixture(t)
  const job = value(await api.jobs.saveJob({ details: { title: 'Secret title', companyNameRaw: 'Secret company' }, source: { url: 'https://example.com', cleanedContent: 'Secret body' } }))
  assert.equal(value(await api.jobs.getJob({ id: job.id })).title, job.title)
  const sources = value(await api.jobs.listSources({ jobId: job.id }))
  assert.equal(sources.total, 1); assert.equal(sources.items[0].cleanedContent, 'Secret body')
})

test('partial writes roll back completely while preserving the original failure', async t => {
  const f = await seed(t), db = f.database.connection
  assert.throws(() => f.database.transactions.write(() => {
    db.prepare('UPDATE jobs SET title=? WHERE id=?').run('partial', f.job.id)
    db.prepare('UPDATE profiles SET name=? WHERE id=?').run('partial', f.profile.id)
    throw new DataError('CONFLICT')
  }), { code: 'CONFLICT' })
  assert.equal(value(await f.api.jobs.getJob({ id: f.job.id })).title, f.job.title)
  assert.equal(value(await f.api.profiles.getProfile({ id: f.profile.id })).name, f.profile.name)
  assert.equal(value(await f.api.profiles.getProfile({ id: f.profile.id })).revision, f.profile.revision + 2)
})

test('read transactions reject nesting and thenables and roll back partial writes', async t => {
  const f = await seed(t), db = f.database.connection, tx = f.database.transactions
  for (const mode of ['read', 'write'] as const) {
    assert.throws(() => tx[mode](() => tx.read(() => 1)), { code: 'INVALID_STATE' })
    assert.throws(() => tx[mode](() => {
      db.prepare('UPDATE jobs SET title=? WHERE id=?').run('partial', f.job.id)
      return { then() {} }
    }), { code: 'INVALID_STATE' })
  }
  assert.equal(tx.read(() => db.prepare('SELECT title FROM jobs WHERE id=?').get(f.job.id)?.title), f.job.title)
})

test('business reads and invalid reads leave business data unchanged', async t => {
  const f = await seed(t), before = f.database.connection.prepare('SELECT * FROM jobs').all()
  value(await f.api.jobs.getJob({ id: f.job.id }))
  value(await f.api.jobs.listJobs({ search: 'PRIVATE', limit: 1 }))
  assert.deepEqual(await f.api.jobs.getJob({ id: randomUUID() }), { ok: false, error: 'NOT_FOUND' })
  assert.deepEqual(f.database.connection.prepare('SELECT * FROM jobs').all(), before)
  assert.deepEqual(f.backend.dispatch('profiles', 'createProfile', { name: 'FORGED', actorId: 'FORGED' }), { ok: false, error: 'INVALID_INPUT' })
  assert.equal(value(await f.api.profiles.listProfiles({})).total, 1)
})

test('a late source failure rolls back the job inserted earlier in the same business operation', async t => {
  const f = fixture(t), db = f.database.connection
  db.exec("CREATE TRIGGER fixture_source_failure BEFORE INSERT ON job_sources BEGIN SELECT RAISE(ABORT,'fixture'); END")
  assert.deepEqual(await f.api.jobs.saveJob({ details: { title: 'Rollback', companyNameRaw: 'Company' }, source: { url: 'https://example.com', cleanedContent: 'Source' } }), { ok: false, error: 'CONFLICT' })
  assert.equal(value(await f.api.jobs.listJobs({})).total, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM job_sources').get()?.n, 0)
})

test('a failed event insert rolls back both application status and applied time', async t => {
  const f = await seed(t), db = f.database.connection
  db.exec("CREATE TRIGGER fixture_event_failure BEFORE INSERT ON job_events BEGIN SELECT RAISE(ABORT,'fixture'); END")
  assert.deepEqual(await f.api.applications.changeStatus({ jobId: f.job.id, status: 'APPLIED' }), { ok: false, error: 'CONFLICT' })
  const job = value(await f.api.jobs.getJob({ id: f.job.id }))
  assert.equal(job.applicationStatus, 'NOT_STARTED'); assert.equal(job.appliedAt, null)
  assert.equal(value(await f.api.applications.listEvents({ jobId: f.job.id })).total, 0)
})
