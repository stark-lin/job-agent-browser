import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { migrate, migrations } from '../src/platform/database/migrations'
import { Transactions } from '../src/platform/database/transactions'
import { Store } from '../src/platform/database/repositories/store'
import { composeBackend } from '../src/platform/database/backend'
import { operationReceipts } from '../src/platform/database/operation-receipts'

function legacyFixture(t: TestContext) {
  const db = new DatabaseSync(':memory:'), transactions = new Transactions(db)
  migrate(db, migrations.slice(0, 14)); transactions.protectAudit()
  const backend = composeBackend({ connection: db, transactions, close: () => db.close() })
  t.after(() => backend.close())
  const store = new Store(db, transactions), tx = transactions.forActor('USER')
  const profile = backend.profiles.createProfile({ name: 'Keep person', introduction: 'Keep introduction' })
  const item = backend.profiles.addItem({ profileId: profile.id, details: { type: 'PROJECT', title: 'Keep project' } })
  const job = backend.jobs.saveJob({ details: { title: 'Keep role', companyNameRaw: 'Keep company' } })
  const facts = ['Page 2\nOriginal quote: 原文片段', ''].map((evidence, index) => {
    const fact = { id: randomUUID(), profileId: profile.id, profileItemId: index ? null : item.id,
      kind: 'OTHER' as const, content: `Keep fact ${index}: evidence is a regular word`, tags: ['keep'], evidence,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }
    tx.write({ event: 'FACT_ADD', action: 'CREATE', target: 'fact' }, () => store.insert('fact', fact))
    return fact
  })
  const run = backend.resumes.createRun({ jobId: job.id, profileId: profile.id })
  const request = { profileId: profile.id, profileItemId: null, expectedRevision: 3, requestId: randomUUID(),
    details: { kind: 'OTHER', content: facts[1].content, tags: facts[1].tags, evidence: '' } }
  const result = { ...facts[1], revision: 4 }, receipts = operationReceipts(db)
  tx.write({ event: 'FACT_ADD', action: 'CREATE', target: 'fact' }, () => {
    receipts.put('profile.add_fact', request.requestId, request, 'fact', result)
    const updatedResult = { ...facts[0], revision: 3 }
    receipts.put('profile.update_fact', randomUUID(), {}, 'fact', updatedResult)
    receipts.put('job.import', randomUUID(), {}, 'job', job)
  })
  const rows = (table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
  const triggers = () => db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()
  return { db, transactions, tx, backend, store, profile, facts, run, request, result, receipts, rows, triggers }
}

test('V15 removes attachments from facts, snapshots and receipts, preserving all other data and protections', t => {
  const f = legacyFixture(t), { db, backend } = f
  const before = Object.fromEntries(['profiles', 'profile_items', 'jobs', 'audit_logs', 'schema_migrations', 'operation_receipts', 'generation_runs'].map(table => [table, f.rows(table)]))
  const triggerNames = f.triggers().map(row => row.name)
  migrate(db, migrations.slice(0, 15))
  assert(!db.prepare('PRAGMA table_info(facts)').all().some(column => column.name === 'evidence'))
  const expectedFacts = f.facts.map(({ evidence: _removed, ...fact }) => fact).sort((a, b) => a.id.localeCompare(b.id))
  assert.deepEqual(backend.profiles.listFacts({ profileId: f.profile.id }).items, expectedFacts)
  const nextRun = backend.resumes.getRun({ id: f.run.id }).run
  assert.deepEqual(nextRun, { ...f.run, inputSnapshot: { ...f.run.inputSnapshot, facts: expectedFacts } })
  for (const table of ['profiles', 'profile_items', 'jobs', 'audit_logs']) assert.deepEqual(f.rows(table), before[table])
  assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<=14 ORDER BY version').all(), before.schema_migrations)
  assert.deepEqual(f.rows('operation_receipts').map(row => ({ ...row })), before.operation_receipts.map(row => {
    if (row.target_type !== 'fact') return { ...row }
    const { evidence: _removed, ...result } = JSON.parse(String(row.result_json))
    return { ...row, result_json: JSON.stringify(result) }
  }))
  assert.deepEqual(f.triggers().map(row => row.name), triggerNames)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.throws(() => db.prepare('UPDATE facts SET content=?').run('forged'), /WRITE_CONTEXT_REQUIRED/)
  assert.throws(() => db.prepare('UPDATE generation_runs SET stage=?').run('forged'), /WRITE_CONTEXT_REQUIRED/)
  assert.throws(() => f.tx.write({ event: 'GENERATION_UPDATE', action: 'UPDATE', target: 'generation_run' }, () => {
    db.prepare("UPDATE generation_runs SET input_snapshot_json=json_set(input_snapshot_json,'$.profile.name','forged')").run()
  }), { code: 'CONFLICT' })
  assert.deepEqual(backend.resumes.getRun({ id: f.run.id }).run, nextRun)
  const profile = backend.profiles.getProfile({ id: f.profile.id })
  const edited = backend.profileWrites.updateFact({ id: f.facts[0].id, profileId: profile.id, requestId: randomUUID(),
    expectedRevision: profile.revision, changes: { tags: ['updated'] } })
  assert.equal(edited.revision, profile.revision + 1)
  assert.equal(backend.profiles.getProfile({ id: profile.id }).revision, edited.revision)
  assert(db.prepare("SELECT * FROM audit_logs WHERE target_id=? AND action='UPDATE'").get(edited.id))
  backend.generation.start({ id: f.run.id })
  assert(db.prepare("SELECT * FROM audit_logs WHERE target_id=? AND event_type='GENERATION_START'").get(f.run.id))
  const stored = f.rows('generation_runs'), receipts = f.rows('operation_receipts'), audits = f.rows('audit_logs')
  migrate(db, migrations.slice(0, 15))
  assert.deepEqual(f.rows('generation_runs'), stored); assert.deepEqual(f.rows('operation_receipts'), receipts)
  assert.deepEqual(f.rows('audit_logs'), audits)
  const { evidence: _removed, ...details } = f.request.details
  assert.throws(() => f.tx.write({ event: 'FACT_ADD', action: 'CREATE', target: 'fact' }, () =>
    f.receipts.get('profile.add_fact', f.request.requestId, { ...f.request, details })), { code: 'CONFLICT' })
  const request = { profileId: profile.id, requestId: randomUUID(), expectedRevision: edited.revision,
    details: { kind: 'SKILL', content: 'New compact fact', tags: ['SQL'] } }
  const added = backend.profileWrites.addFact(request)
  assert(!('evidence' in added)); assert.deepEqual(backend.profileWrites.addFact(request), added)
})

test('V15 failure rolls back removed fields, JSON cleanup, triggers and migration journal together', t => {
  const f = legacyFixture(t), before = Object.fromEntries(['facts', 'generation_runs', 'operation_receipts', 'profiles', 'audit_logs', 'schema_migrations'].map(table => [table, f.rows(table)]))
  const triggers = f.triggers(), step = migrations[14]
  assert.throws(() => migrate(f.db, [...migrations.slice(0, 14), { ...step, sql: step.sql + '\nSELECT missing_migration_function();' }]))
  for (const [table, rows] of Object.entries(before)) assert.deepEqual(f.rows(table), rows)
  assert.deepEqual(f.triggers(), triggers)
  assert.throws(() => f.db.exec("UPDATE facts SET evidence='forged'"), /WRITE_CONTEXT_REQUIRED/)
  migrate(f.db)
  assert(!f.db.prepare('PRAGMA table_info(facts)').all().some(column => column.name === 'evidence'))
})
