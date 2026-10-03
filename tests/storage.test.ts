import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { constants, DatabaseSync } from 'node:sqlite'
import { fixture, seed, value } from './helpers'
import { migrate, migrations } from '../src/platform/database/migrations'
import { openDatabase } from '../src/platform/database/sqlite'

function tempDatabase(t: import('node:test').TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'job-storage-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return join(dir, 'database.sqlite')
}

test('migrations create all tables once and enforce configured SQLite settings', (t) => {
  const f = fixture(t), db = f.database.connection
  assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
  assert.equal(tables.length, 12)
  migrate(db)
  assert.equal(db.prepare('SELECT count(*) count FROM schema_migrations').get()?.count, 1)
})

test('failed migration rolls back both schema changes and migration version', (t) => {
  const f = fixture(t), db = f.database.connection
  assert.throws(() => migrate(db, [...migrations, { version: 2, sql: 'CREATE TABLE partially_created(id TEXT); INVALID SQL;' }]))
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='partially_created'").get(), undefined)
  assert.equal(db.prepare('SELECT max(version) version FROM schema_migrations').get()?.version, 1)
})

test('future versions and checksum mismatches fail startup without resetting stored data', (t) => {
  const path = tempDatabase(t), db = openDatabase(path)
  db.connection.exec('INSERT INTO schema_migrations VALUES (2, \'future\')')
  db.close()
  assert.throws(() => openDatabase(path), /UNSUPPORTED_DATABASE_VERSION/)
  const existing = new DatabaseSync(path)
  assert.equal(existing.prepare('SELECT count(*) count FROM schema_migrations').get()?.count, 2)
  existing.exec("DELETE FROM schema_migrations WHERE version=2; UPDATE schema_migrations SET checksum='mismatch'")
  existing.close()
  assert.throws(() => openDatabase(path), /MIGRATION_MISMATCH/)
})

test('data survives reopen and interrupted generation is recovered with SYSTEM audit', async (t) => {
  const path = tempDatabase(t), first = fixture(t, path)
  const job = value(await first.api.jobs.saveJob({ details: { title: 'Persisted', companyNameRaw: 'Company' } }))
  const profile = value(await first.api.profiles.createProfile({ name: 'Person' }))
  const fact = value(await first.api.profiles.addFact({ profileId: profile.id, details: { kind: 'SKILL', content: 'TypeScript' } }))
  const run = value(await first.api.resumes.createRun({ jobId: job.id, profileId: profile.id, factIds: [fact.id] }))
  first.backend.generation.start({ id: run.id })
  first.backend.close()
  const second = fixture(t, path)
  assert.equal(value(await second.api.jobs.getJob({ id: job.id })).title, 'Persisted')
  assert.equal(value(await second.api.resumes.getRun({ id: run.id })).run.status, 'INTERRUPTED')
  const audit = value(await second.api.audit.list({ targetId: run.id })).items
  assert.equal(audit[0].eventType, 'GENERATION_RECOVER')
  assert.equal(audit[0].actorId, 'system')
  assert.equal(audit[0].source, 'STARTUP')
  assert.equal(second.database.connection.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal')
})

test('audit append failure rolls business back and records the failed operation', async (t) => {
  const f = await seed(t), db = f.database.connection
  let denied = false
  db.setAuthorizer((action, table) => {
    if (!denied && table === 'audit_logs' && action === constants.SQLITE_INSERT) { denied = true; return constants.SQLITE_DENY }
    return constants.SQLITE_OK
  })
  const result = await f.api.jobs.setArchived({ id: f.job.id, archived: true })
  assert.deepEqual(result, { ok: false, error: 'STORAGE_UNAVAILABLE' })
  f.database.transactions.protectAudit()
  assert.equal(value(await f.api.jobs.getJob({ id: f.job.id })).archivedAt, null)
  const latest = value(await f.api.audit.list({})).items[0]
  assert.equal(latest.status, 'FAILURE')
  assert.equal(latest.eventType, 'JOB_ARCHIVE')
})

test('unwritable failure audit is reported explicitly and produces no false success', async (t) => {
  const f = await seed(t), before = value(await f.api.audit.list({})).total
  f.database.connection.exec('PRAGMA query_only=ON')
  assert.deepEqual(await f.api.jobs.setArchived({ id: f.job.id, archived: true }), { ok: false, error: 'AUDIT_UNAVAILABLE' })
  f.database.connection.exec('PRAGMA query_only=OFF')
  assert.equal(value(await f.api.audit.list({})).total, before)
  assert.equal(value(await f.api.jobs.getJob({ id: f.job.id })).archivedAt, null)
})

test('nested and asynchronous transaction callbacks cannot partially commit', async (t) => {
  const f = await seed(t), tx = f.database.transactions.forActor('USER')
  const command = { event: 'JOB_EDIT', action: 'UPDATE' as const, target: 'job' as const }
  assert.throws(() => tx.write(command, () => {
    f.database.connection.prepare('UPDATE jobs SET title=? WHERE id=?').run('partial', f.job.id)
    return tx.write(command, () => 1)
  }), { code: 'INVALID_STATE' })
  assert.throws(() => tx.write(command, () => {
    f.database.connection.prepare('UPDATE jobs SET title=? WHERE id=?').run('partial', f.job.id)
    return Promise.resolve(1)
  }), { code: 'INVALID_STATE' })
  assert.equal(value(await f.api.jobs.getJob({ id: f.job.id })).title, 'PRIVATE_JOB_TITLE')
})
