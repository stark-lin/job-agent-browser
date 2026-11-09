import { randomUUID } from 'node:crypto'
import { LegacyTransactions } from './legacy-migration-fixture'
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
  const cleanups: (() => void | Promise<void>)[] = []
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  return { path: join(dir, 'database.sqlite'), resources: { after: (fn: () => void | Promise<void>) => { cleanups.push(fn) } } }
}

test('migrations create all tables once and enforce configured SQLite settings', (t) => {
  const f = fixture(t), db = f.database.connection
  assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
  assert.equal(tables.length, 26)
  assert(tables.some(table => table.name === 'profile_order_counters'))
  assert(tables.some(table => table.name === 'agent_react_cycles'))
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
  const { path } = tempDatabase(t), db = openDatabase(path)
  db.connection.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(migrations.length + 1, 'future')
  db.close()
  assert.throws(() => openDatabase(path), /UNSUPPORTED_DATABASE_VERSION/)
  const existing = new DatabaseSync(path)
  assert.equal(existing.prepare('SELECT count(*) count FROM schema_migrations').get()?.count, migrations.length + 1)
  existing.exec("DELETE FROM schema_migrations WHERE version>2; UPDATE schema_migrations SET checksum='mismatch'")
  existing.close()
  assert.throws(() => openDatabase(path), /MIGRATION_MISMATCH/)
})

test('data survives reopen and interrupted generation is recovered', async (t) => {
  const { path, resources } = tempDatabase(t), first = fixture(resources, path)
  const job = value(await first.api.jobs.saveJob({ details: { title: 'Persisted', companyNameRaw: 'Company' } }))
  const profile = value(await first.api.profiles.createProfile({ name: 'Person', introduction: 'Original introduction.\nSecond sentence.' }))
  value(await first.api.profiles.addFact({ profileId: profile.id, details: { kind: 'SKILL', content: 'TypeScript' } }))
  const run = value(await first.api.resumes.createRun({ jobId: job.id, profileId: profile.id }))
  first.backend.close()
  const second = fixture(resources, path)
  assert.equal(value(await second.api.profiles.getProfile({ id: profile.id })).introduction, profile.introduction)
  assert.equal(value(await second.api.resumes.getRun({ id: run.id })).run.inputSnapshot.profile.introduction, profile.introduction)
  assert.equal(value(await second.api.jobs.getJob({ id: job.id })).title, 'Persisted')
  assert.equal(value(await second.api.resumes.getRun({ id: run.id })).run.state, 'INTERRUPTED')
  assert.equal(second.database.connection.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal')
})

test('failed business writes and read-only storage preserve their original errors and data', async t => {
  const f = await seed(t), db = f.database.connection
  db.setAuthorizer((action, table) => action === constants.SQLITE_UPDATE && table === 'jobs' ? constants.SQLITE_DENY : constants.SQLITE_OK)
  assert.deepEqual(await f.api.jobs.setArchived({ id: f.job.id, archived: true }), { ok: false, error: 'STORAGE_UNAVAILABLE' })
  db.setAuthorizer(null)
  assert.equal(value(await f.api.jobs.getJob({ id: f.job.id })).archivedAt, null)
  db.exec('PRAGMA query_only=ON')
  assert.deepEqual(await f.api.jobs.setArchived({ id: f.job.id, archived: true }), { ok: false, error: 'STORAGE_UNAVAILABLE' })
  db.exec('PRAGMA query_only=OFF')
  assert.equal(value(await f.api.jobs.getJob({ id: f.job.id })).archivedAt, null)
})

test('nested and asynchronous transaction callbacks cannot partially commit', async (t) => {
  const f = await seed(t), tx = f.database.transactions
  assert.throws(() => tx.write(() => {
    f.database.connection.prepare('UPDATE jobs SET title=? WHERE id=?').run('partial', f.job.id)
    return tx.write(() => 1)
  }), { code: 'INVALID_STATE' })
  assert.throws(() => tx.write(() => {
    f.database.connection.prepare('UPDATE jobs SET title=? WHERE id=?').run('partial', f.job.id)
    return Promise.resolve(1)
  }), { code: 'INVALID_STATE' })
  assert.equal(value(await f.api.jobs.getJob({ id: f.job.id })).title, 'PRIVATE_JOB_TITLE')
})

for (const version of [1, 2, 4, 5, 9, 14, 21]) test(`V${version} upgrades to V23 preserving business rows and historical checksums`, t => {
  const { path, resources } = tempDatabase(t), connection = new DatabaseSync(path)
  migrate(connection, migrations.slice(0, version))
  const transactions = new LegacyTransactions(connection)
  const jobs = createJobService(jobRepository(new Store(connection)), transactions, { id: randomUUID, now: () => new Date().toISOString() })
  const job = jobs.saveJob({ details: { title: 'Persisted private role', companyNameRaw: 'Company' } })
  const before = connection.prepare('SELECT * FROM jobs').all()
  const versions = connection.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
  connection.close()
  const next = openDatabase(path); resources.after(next.close)
  assert.deepEqual(next.connection.prepare('SELECT * FROM jobs').all(), before)
  assert.equal(next.connection.prepare('SELECT title FROM jobs WHERE id=?').get(job.id)?.title, job.title)
  assert.deepEqual(next.connection.prepare('SELECT * FROM schema_migrations WHERE version<=? ORDER BY version').all(version), versions)
  assert.equal(next.connection.prepare('SELECT max(version) v FROM schema_migrations').get()?.v, 23)
  assert.equal(next.connection.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('audit_logs','capability_audit','invocation_owners')").get()?.n, 0)
})

test('legacy generation is rejected before journal/schema writes and bytes remain unchanged', t => {
  const { path } = tempDatabase(t), old = new DatabaseSync(path)
  old.exec("CREATE TABLE facts(id TEXT, verification_status TEXT); INSERT INTO facts VALUES ('old', 'CONFIRMED')")
  old.close()
  const bytes = readFileSync(path)
  assert.throws(() => openDatabase(path), /INCOMPATIBLE_DATABASE_GENERATION/)
  assert.deepEqual(readFileSync(path), bytes)
})

test('V6 upgrade preserves incomplete profile values and initializes introduction and revision', t => {
  const { path, resources } = tempDatabase(t), connection = new DatabaseSync(path)
  migrate(connection, migrations.slice(0, 6))
  const transactions = new LegacyTransactions(connection), store = new Store(connection)
  const profile = { id: randomUUID(), name: 'Existing person', email: '', phone: '', location: '', links: [], updatedAt: new Date().toISOString() }
  transactions.write(() => store.insert('profile', profile))
  const versions = connection.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
  connection.close()
  const next = openDatabase(path); resources.after(next.close)
  assert.deepEqual(new Store(next.connection).get('profile', profile.id), { ...profile, title: profile.name, introduction: '', revision: 1 })
  assert.deepEqual(next.connection.prepare('SELECT * FROM schema_migrations WHERE version<=6 ORDER BY version').all(), versions)
})
