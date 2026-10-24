import { randomUUID } from 'node:crypto'
import { Transactions } from '../src/platform/database/transactions'
import { Store } from '../src/platform/database/repositories/store'
import { jobRepository } from '../src/platform/database/repositories/jobs'
import { createJobService } from '../src/domain/job/job.service'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
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
  assert.equal(tables.length, 21)
  migrate(db)
  assert.equal(db.prepare('SELECT count(*) count FROM schema_migrations').get()?.count, migrations.length)
})

test('failed migration rolls back both schema changes and migration version', (t) => {
  const f = fixture(t), db = f.database.connection
  assert.throws(() => migrate(db, [...migrations, { version: migrations.length + 1, sql: 'CREATE TABLE partially_created(id TEXT); INVALID SQL;' }]))
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='partially_created'").get(), undefined)
  assert.equal(db.prepare('SELECT max(version) version FROM schema_migrations').get()?.version, migrations.length)
})

test('future versions and checksum mismatches fail startup without resetting stored data', (t) => {
  const path = tempDatabase(t), db = openDatabase(path)
  db.connection.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(migrations.length + 1, 'future')
  db.close()
  assert.throws(() => openDatabase(path), /UNSUPPORTED_DATABASE_VERSION/)
  const existing = new DatabaseSync(path)
  assert.equal(existing.prepare('SELECT count(*) count FROM schema_migrations').get()?.count, migrations.length + 1)
  existing.exec("DELETE FROM schema_migrations WHERE version>2; UPDATE schema_migrations SET checksum='mismatch'")
  existing.close()
  assert.throws(() => openDatabase(path), /MIGRATION_MISMATCH/)
})

test('data survives reopen and interrupted generation is recovered with SYSTEM audit', async (t) => {
  const path = tempDatabase(t), first = fixture(t, path)
  const job = value(await first.api.jobs.saveJob({ details: { title: 'Persisted', companyNameRaw: 'Company' } }))
  const profile = value(await first.api.profiles.createProfile({ name: 'Person' }))
  value(await first.api.profiles.addFact({ profileId: profile.id, details: { kind: 'SKILL', content: 'TypeScript' } }))
  const run = value(await first.api.resumes.createRun({ jobId: job.id, profileId: profile.id }))
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

test('matching-generation version-1 upgrade preserves business rows, audit sequences and existing migration checksums', t => {
  const path = tempDatabase(t), connection = new DatabaseSync(path)
  // Exercise incremental initialization within the new schema generation.
  const transactions = new Transactions(connection)
  migrate(connection, migrations.slice(0, 1)); transactions.protectAudit()
  const jobs = createJobService(jobRepository(new Store(connection, transactions)), transactions.forActor('USER'), { id: randomUUID, now: () => new Date().toISOString() })
  const job = jobs.saveJob({ details: { title: 'Persisted private role', companyNameRaw: 'Company' } })
  const before = connection.prepare('SELECT * FROM audit_logs ORDER BY sequence').all()
  const checksum = connection.prepare('SELECT checksum FROM schema_migrations WHERE version=1').get()?.checksum
  connection.close()
  const next = openDatabase(path)
  t.after(next.close)
  assert.equal(next.connection.prepare('SELECT title FROM jobs WHERE id=?').get(job.id)?.title, 'Persisted private role')
  assert.deepEqual(next.connection.prepare('SELECT * FROM audit_logs ORDER BY sequence').all(), before)
  assert.equal(next.connection.prepare('SELECT checksum FROM schema_migrations WHERE version=1').get()?.checksum, checksum)
  const requestId = randomUUID()
  next.transactions.recordAI(requestId, null)
  assert.throws(() => next.transactions.recordAI(requestId, null), { code: 'AUDIT_UNAVAILABLE' })
  assert.equal(next.connection.prepare('SELECT count(*) count FROM audit_logs WHERE request_id=?').get(requestId)?.count, 1)
  assert.throws(() => next.connection.exec('DELETE FROM audit_logs'))
  assert.throws(() => next.connection.exec("UPDATE audit_logs SET component='forged'"))
  assert.throws(() => next.connection.exec('INSERT INTO audit_logs SELECT * FROM audit_logs LIMIT 1'))
})

test('matching-generation version-2 upgrade adds capability audit without changing historical rows or migration checksums', t => {
  const path = tempDatabase(t), connection = new DatabaseSync(path), transactions = new Transactions(connection)
  migrate(connection, migrations.slice(0, 2)); transactions.protectAudit()
  const jobs = createJobService(jobRepository(new Store(connection, transactions)), transactions.forActor('USER'), { id: randomUUID, now: () => new Date().toISOString() })
  jobs.saveJob({ details: { title: 'Retained role', companyNameRaw: 'Retained company' } })
  transactions.recordAI(randomUUID(), 'AI_CANCELLED')
  const audits = connection.prepare('SELECT * FROM audit_logs ORDER BY sequence').all()
  const versions = connection.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
  connection.close()
  const next = openDatabase(path)
  t.after(next.close)
  assert.deepEqual(next.connection.prepare('SELECT * FROM audit_logs ORDER BY sequence').all(), audits)
  assert.deepEqual(next.connection.prepare('SELECT * FROM schema_migrations WHERE version<=2 ORDER BY version').all(), versions)
  assert.equal(next.connection.prepare('SELECT count(*) count FROM capability_audit').get()?.count, 0)
  assert.equal(next.connection.prepare('SELECT count(*) count FROM jobs').get()?.count, 1)
})

test('legacy generation is rejected before journal/schema writes and bytes remain unchanged', t => {
  const path = tempDatabase(t), old = new DatabaseSync(path)
  old.exec("CREATE TABLE facts(id TEXT, verification_status TEXT); INSERT INTO facts VALUES ('old', 'CONFIRMED')")
  old.close()
  const bytes = readFileSync(path)
  assert.throws(() => openDatabase(path), /INCOMPATIBLE_DATABASE_GENERATION/)
  assert.deepEqual(readFileSync(path), bytes)
})

test('matching-generation version-4 upgrade adds durable receipts and preserves business data, audits and migration checksums', t => {
  const path = tempDatabase(t), connection = new DatabaseSync(path), transactions = new Transactions(connection)
  migrate(connection, migrations.slice(0, 4)); transactions.protectAudit()
  const jobs = createJobService(jobRepository(new Store(connection, transactions)), transactions.forActor('USER'), { id: randomUUID, now: () => new Date().toISOString() })
  const saved = jobs.saveJob({ details: { title: 'Existing v4 job', companyNameRaw: 'Company' } })
  const audits = connection.prepare('SELECT * FROM audit_logs ORDER BY sequence').all()
  const versions = connection.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
  connection.close()
  const next = openDatabase(path)
  t.after(next.close)
  assert.deepEqual(next.connection.prepare('SELECT * FROM audit_logs ORDER BY sequence').all(), audits)
  assert.deepEqual(next.connection.prepare('SELECT * FROM schema_migrations WHERE version<=4 ORDER BY version').all(), versions)
  assert.equal(next.connection.prepare('SELECT title FROM jobs WHERE id=?').get(saved.id)?.title, 'Existing v4 job')
  assert.equal(next.connection.prepare('SELECT count(*) n FROM operation_receipts').get()?.n, 0)
})

test('matching-generation version-5 upgrade adds chat storage without changing prior checksums, jobs or audits', t => {
  const path = tempDatabase(t), connection = new DatabaseSync(path), transactions = new Transactions(connection)
  migrate(connection, migrations.slice(0, 5)); transactions.protectAudit()
  const jobs = createJobService(jobRepository(new Store(connection, transactions)), transactions.forActor('USER'), { id: randomUUID, now: () => new Date().toISOString() })
  const saved = jobs.saveJob({ details: { title: 'Existing v5 job', companyNameRaw: 'Company' } })
  const audits = connection.prepare('SELECT * FROM audit_logs ORDER BY sequence').all(), versions = connection.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
  connection.close()
  const next = openDatabase(path); t.after(next.close)
  assert.deepEqual(next.connection.prepare('SELECT * FROM schema_migrations WHERE version<=5 ORDER BY version').all(), versions)
  assert.deepEqual(next.connection.prepare('SELECT * FROM audit_logs ORDER BY sequence').all(), audits)
  assert.equal(next.connection.prepare('SELECT title FROM jobs WHERE id=?').get(saved.id)?.title, 'Existing v5 job')
  for (const table of ['chat_sessions', 'chat_runs', 'chat_items']) assert.equal(next.connection.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n, 0)
})
