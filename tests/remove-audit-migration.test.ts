import { Store } from '../src/platform/database/repositories/store'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { migrate, migrations, DATABASE_GENERATION } from '../src/platform/database/migrations'
import { composeBackend } from '../src/platform/database/backend'
import { LegacyTransactions } from './legacy-migration-fixture'
import { references } from '../src/platform/database/references'
import { published, value } from './helpers'

const rows = (db: DatabaseSync, table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
const objects = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')").all().map(row => String(row.name))

test('historical V1–V24 generated SQL keeps every original checksum', () => {
  const expected = JSON.parse(readFileSync('tests/fixtures/migration-checksums.json', 'utf8'))
  assert.deepEqual(migrations.slice(0, 24).map(step => ({ version: step.version, checksum: createHash('sha256').update(step.sql).digest('hex') })), expected)
})

test('fresh database reaches V22 with business constraints and no legacy audit objects', () => {
  const db = new DatabaseSync(':memory:')
  try {
    migrate(db, migrations.slice(0, 22))
    assert.equal(db.prepare('PRAGMA application_id').get()?.application_id, DATABASE_GENERATION)
    assert.equal(db.prepare('SELECT max(version) v FROM schema_migrations').get()?.v, 22)
    const names = objects(db)
    assert(!names.some(name => /^(audit_|capability_audit|guard_|reuse_)/.test(name)))
    assert(!names.includes('invocation_owners'))
    for (const name of ['identity_jobs', 'immutable_snapshot', 'immutable_legacy_generation', 'profile_revision', 'revision_facts_insert', 'revision_profile_items_update', 'agent_item_session']) assert(names.includes(name), name)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { db.close() }
})

function legacy(t: import('node:test').TestContext) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  migrate(db, migrations.slice(0, 21))
  const transactions = new LegacyTransactions(db)
  const backend = composeBackend({ connection: db, transactions, close: () => db.close() })
  t.after(() => backend.close())
  const job = backend.jobs.saveJob({ details: { title: 'Keep job', companyNameRaw: 'Keep company' } }, randomUUID())
  const profile = { id: randomUUID(), name: 'Keep person', introduction: '', email: '', phone: '', location: '', links: [], revision: 1, updatedAt: new Date().toISOString() }
  transactions.write(() => new Store(db).insert('profile', profile))
  const item = backend.profiles.addItem({ profileId: profile.id, details: { type: 'PROJECT', title: 'Keep project' } })
  const fact = backend.profiles.addFact({ profileId: profile.id, profileItemId: item.id, details: { kind: 'OTHER', content: 'Keep fact' } })
  const run = backend.resumes.createRun({ jobId: job.id, profileId: profile.id }, { start: true })
  backend.generation.rewriteBullet({ runId: run.id, bulletId: run.assembled!.projects[0].bullets[0].id, text: 'Keep rewritten fact', requestId: randomUUID() })
  backend.generation.beginValidation(run.id)
  backend.generation.preparePublication(run.id)
  backend.generation.publishArtifact({ runId: run.id })
  const prompt = backend.chats.start({ requestId: randomUUID(), message: 'Keep transcript', choice: { providerId: 'fixture', modelId: 'test' } })
  backend.chats.startCycle(prompt.runId, 1, 'start')
  backend.chats.saveModelRequest(prompt.runId, { ordinal: 1, providerId: 'fixture', modelId: 'test', preparedAt: 'start', purpose: 'agent-turn', loadoutVersion: 1, expectedTools: [], piTools: [], tools: [], verification: 'matched' }, 1)
  backend.chats.saveProviderResponse(prompt.runId, { content: 'Keep provider reply', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } }, 1, 1)
  backend.chats.append(prompt.runId, { type: 'assistant_message', text: 'Keep answer' }, 'completed')
  backend.chats.settleCycle(prompt.runId, 1, 'CONTINUE', null, 'end')
  // Seed the frozen START-only audit/owner rows which V22 intentionally discards.
  db.function('capability_audit_allowed', () => 1)
  const invocationId = randomUUID()
  db.prepare(`INSERT INTO capability_audit(invocation_id,phase,timestamp,agent_id,tool_name,mode,status)
    VALUES(?,'START',?,'fixture','job.get','read','STARTED')`).run(invocationId, new Date().toISOString())
  db.prepare('INSERT INTO invocation_owners VALUES(?,?)').run(invocationId, backend.lease.id)
  return { db, backend, job, profile, fact, run }
}

test('V21 upgrade discards audit history while preserving business state, receipts, leases and Agent Trace', t => {
  const f = legacy(t), { db } = f
  const tables = ['jobs', 'profiles', 'facts', 'generation_runs', 'artifacts', 'artifact_facts', 'resume_bullet_rewrites', 'operation_receipts', 'resume_start_receipts', 'runtime_instances', 'runtime_work', 'chat_sessions', 'agent_runs', 'agent_items', 'agent_react_cycles', 'agent_model_requests', 'agent_model_responses']
  const before = tables.map(table => rows(db, table))
  const versions = rows(db, 'schema_migrations')
  db.exec("CREATE TRIGGER guard_custom_business BEFORE UPDATE ON jobs BEGIN SELECT 1; END")
  migrate(db, migrations.slice(0, 22))
  tables.forEach((table, index) => assert.deepEqual(rows(db, table), before[index], table))
  assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<=21 ORDER BY version').all(), versions)
  assert(objects(db).includes('guard_custom_business'))
  assert(!objects(db).includes('audit_logs')); assert(!objects(db).includes('capability_audit')); assert(!objects(db).includes('invocation_owners'))
  const previous = f.backend.profiles.getProfile({ id: f.profile.id }).revision
  f.backend.profiles.editFact({ id: f.fact.id, details: { kind: 'OTHER', content: 'Changed' } })
  assert.equal(f.backend.profiles.getProfile({ id: f.profile.id }).revision, previous + 1)
  assert.throws(() => db.prepare('UPDATE jobs SET id=? WHERE id=?').run(randomUUID(), f.job.id))
  assert.throws(() => db.prepare('UPDATE generation_runs SET input_snapshot_json=? WHERE id=?').run('{}', f.run.id))
  assert.throws(() => db.prepare('UPDATE generation_runs SET legacy_payload_json=? WHERE id=?').run('{}', f.run.id))
  assert.throws(() => db.prepare('UPDATE facts SET profile_id=? WHERE id=?').run(randomUUID(), f.fact.id))
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  migrate(db)
})

test('failed V22 rolls back dropped tables, triggers, audit history and journal together', t => {
  const { db } = legacy(t), before = rows(db, 'audit_logs'), triggers = objects(db)
  const last = migrations[21]
  assert.throws(() => migrate(db, [...migrations.slice(0, 21), { ...last, sql: last.sql + '\nSELECT missing_migration_function();' }]))
  assert.deepEqual(objects(db), triggers)
  assert.deepEqual(rows(db, 'audit_logs'), before)
  assert.equal(db.prepare('SELECT max(version) v FROM schema_migrations').get()?.v, 21)
})

test('missing references never require deletion history and deleted UUIDs may be reused', async t => {
  const f = await published(t), refs = references(f.database.connection), unknown = randomUUID()
  assert.deepEqual(refs.resolve('job', unknown), { type: 'job', id: unknown, status: 'MISSING' })
  value(await f.api.jobs.deleteJob({ id: f.job.id }))
  value(await f.api.profiles.deleteProfile({ id: f.profile.id }))
  assert(value(await f.api.resumes.getArtifact({ id: f.artifact.id })).references.every(ref => ref.status === 'MISSING'))
  assert.equal(refs.resolve('job', f.job.id).status, 'MISSING')
  const company = value(await f.api.jobs.registerCompany({ name: 'Reusable' }))
  f.database.connection.prepare('DELETE FROM companies WHERE id=?').run(company.id)
  const insert = () => f.database.connection.prepare('INSERT INTO companies(id,name,normalized_name,domain,website,logo_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(company.id, company.name, company.normalizedName, company.domain, company.website, company.logoUrl, company.createdAt, company.updatedAt)
  insert()
  assert.throws(insert)
  assert.equal(refs.resolve('company', company.id).status, 'ACTIVE')
})
