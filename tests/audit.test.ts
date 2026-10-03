import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture, seed, published, value } from './helpers'
import { DataError } from '../src/domain/common/errors'

test('business writes internally append audit; multi-row save shares request and transaction', async (t) => {
  const { api } = fixture(t)
  const job = value(await api.jobs.saveJob({ details: { title: 'Secret title', companyNameRaw: 'Secret company' }, source: { url: 'https://example.com', cleanedContent: 'Secret body' } }))
  const entries = value(await api.audit.list({})).items
  assert.equal(entries.length, 2)
  assert.equal(new Set(entries.map((e) => e.transactionId)).size, 1)
  assert.equal(new Set(entries.map((e) => e.requestId)).size, 1)
  assert.equal(entries.every((e) => e.status === 'SUCCESS' && e.error === null && e.actorId === 'local-user'), true)
  assert.equal(entries.some((e) => e.targetId === job.id && e.targetType === 'job'), true)
  assert.equal(JSON.stringify(entries).includes('Secret'), false)
})

test('success and failure audit contain no business bodies or raw errors across all domains', async (t) => {
  const f = await published(t)
  assert.deepEqual(await f.api.jobs.updateDetails({ id: f.job.id, details: { title: 'private replacement', companyNameRaw: 'Private', companyId: randomUUID() } }), { ok: false, error: 'NOT_FOUND' })
  const entries = value(await f.api.audit.list({ limit: 100 })).items
  assert.equal(entries.some((e) => e.status === 'FAILURE' && e.error === 'NOT_FOUND'), true)
  const serialized = JSON.stringify(entries)
  for (const marker of ['PRIVATE_', 'private@example.com', 'private replacement']) assert.equal(serialized.includes(marker), false)
  const columns = f.database.connection.prepare('PRAGMA table_info(audit_logs)').all().map((row) => row.name)
  assert.equal(columns.includes('changes_json'), false)
  assert.equal(columns.includes('metadata_json'), false)
  assert.equal(columns.length, 15)
})

test('partial writes and success audit roll back, then one failure audit commits independently', async (t) => {
  const f = await seed(t), before = value(await f.api.audit.list({})).total
  // Inject a failure after the first row has been written; this exercises the real transaction layer.
  assert.throws(() => f.database.transactions.forActor('USER').write({ event: 'JOB_EDIT', action: 'UPDATE', target: 'job' }, () => {
    f.database.connection.prepare('UPDATE jobs SET title=? WHERE id=?').run('ROLLED_BACK_PRIVATE_BODY', f.job.id)
    throw new DataError('CONFLICT')
  }), { code: 'CONFLICT' })
  assert.equal(value(await f.api.jobs.getJob({ id: f.job.id })).title, 'PRIVATE_JOB_TITLE')
  const entries = value(await f.api.audit.list({}))
  assert.equal(entries.total, before + 1)
  assert.equal(entries.items[0].status, 'FAILURE')
  assert.equal(entries.items[0].error, 'CONFLICT')
  assert.equal(JSON.stringify(entries).includes('ROLLED_BACK'), false)
})

test('business read and audit read never append audit, including invalid reads', async (t) => {
  const f = await seed(t), before = value(await f.api.audit.list({})).total
  value(await f.api.jobs.getJob({ id: f.job.id }))
  value(await f.api.jobs.listJobs({ search: 'PRIVATE', limit: 1 }))
  value(await f.api.profiles.getProfile({ id: f.profile.id }))
  assert.deepEqual(await f.api.jobs.getJob({ id: randomUUID() }), { ok: false, error: 'NOT_FOUND' })
  assert.equal(value(await f.api.audit.list({})).total, before)
})

test('raw writes without transaction context and audit tampering are blocked', async (t) => {
  const f = await seed(t), db = f.database.connection
  assert.throws(() => db.prepare('UPDATE jobs SET title=? WHERE id=?').run('bypass', f.job.id))
  assert.throws(() => db.exec('DELETE FROM audit_logs'))
  assert.throws(() => db.exec("UPDATE audit_logs SET source='forged'"))
  assert.throws(() => db.exec('INSERT INTO audit_logs SELECT * FROM audit_logs LIMIT 1'))
  assert.equal(value(await f.api.jobs.getJob({ id: f.job.id })).title, 'PRIVATE_JOB_TITLE')
})

test('invalid write fields cannot inject audit identity, status or business content', async (t) => {
  const f = fixture(t)
  assert.deepEqual(f.backend.dispatch('profiles', 'createProfile', { name: 'PRIVATE_FORGED', actorId: 'PRIVATE_EMAIL' }), { ok: false, error: 'INVALID_INPUT' })
  const entries = value(await f.api.audit.list({})).items
  assert.equal(entries.length, 1)
  assert.equal(entries[0].status, 'FAILURE')
  assert.equal(entries[0].targetId, null)
  assert.equal(JSON.stringify(entries).includes('PRIVATE_'), false)
})
