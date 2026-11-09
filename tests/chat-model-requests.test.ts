import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { seed, value } from './helpers'
import { composeBackend } from '../src/platform/database/backend'
import { openDatabase } from '../src/platform/database/sqlite'
import { migrate, migrations } from '../src/platform/database/migrations'
import { createAgentRecorder } from '../src/platform/electron/agent-recorder'
import { descriptor } from './disclosure-fixture'
import { toolSnapshot } from '../src/platform/ai/agent-request'
import type { RequestDiagnostic } from '../src/shared/agent'

const choice = { providerId: 'fixture', modelId: 'test' }
const diagnostic = (ordinal: number): RequestDiagnostic => ({ ordinal, ...choice, preparedAt: new Date().toISOString(), purpose: ordinal === 2 ? 'context-summary' : 'agent-turn', loadoutVersion: 1,
  expectedTools: toolSnapshot([descriptor()]), piTools: toolSnapshot([descriptor()]), tools: toolSnapshot([descriptor()]), verification: 'matched' })

test('Main stores deletable diagnostics with pagination, terminal failure and independent transcript state', async t => {
  const f = await seed(t), repo = f.backend.chats
  const ids = repo.start({ requestId: randomUUID(), message: 'PRIVATE_REQUEST_BODY', choice })
  const snapshot = repo.snapshot(ids.runId), recorder = createAgentRecorder(repo, snapshot, () => {}, () => {})
  recorder.receive({ type: 'model.request.prepared', request: diagnostic(1) })
  recorder.receive({ type: 'model.request.prepared', request: diagnostic(2) })
  recorder.receive({ type: 'model.request.activation', activation: { names: ['job.list'], repeats: 1, reason: 'already-active' } })
  recorder.receive({ type: 'model.request.activation', activation: { names: ['job.list'], repeats: 2, reason: 'activation-loop' } })
  const first = value(await f.api.chats.listModelRequests({ runId: ids.runId, limit: 1 }))
  assert.equal(first.total, 2); assert.equal(first.items[0].ordinal, 1)
  assert.deepEqual(first.items[0].activations.map(entry => entry.repeats), [1, 2])
  assert.equal(value(await f.api.chats.listModelRequests({ runId: ids.runId, limit: 1, offset: 1 })).items[0].purpose, 'context-summary')
  assert.deepEqual(await f.api.chats.listModelRequests({ runId: randomUUID() }), { ok: false, error: 'NOT_FOUND' })
  assert.deepEqual(await f.api.chats.listModelRequests({ runId: ids.runId, limit: 101 }), { ok: false, error: 'INVALID_INPUT' })
  assert.deepEqual(await f.api.chats.deleteSession({ id: ids.sessionId }), { ok: false, error: 'INVALID_STATE' })
  assert.equal(repo.listItems(ids.sessionId, 100).total, 1)
  assert(!JSON.stringify(first).includes('PRIVATE_REQUEST_BODY')); assert(!JSON.stringify(first).includes('inputSchema'))
  assert.throws(() => recorder.receive({ type: 'model.request.prepared', request: diagnostic(1) }))
  recorder.finish('failed', 'AGENT_STEP_LIMIT')
  assert.throws(() => repo.saveModelRequest(ids.runId, diagnostic(3)), { code: 'CONFLICT' })
  assert.throws(() => f.database.connection.prepare('INSERT INTO agent_model_requests(run_id,ordinal,metadata_json) VALUES(?,?,?)').run(randomUUID(), 1, '{}'))
  const other = repo.start({ requestId: randomUUID(), message: 'Other', choice })
  repo.saveModelRequest(other.runId, diagnostic(1))
  value(await f.api.chats.deleteSession({ id: ids.sessionId }))
  assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM agent_model_requests WHERE run_id=?').get(ids.runId)?.n, 0)
  assert.equal(repo.listModelRequests(other.runId, 100, 0).total, 1)
  assert.equal(f.backend.jobs.getJob({ id: f.job.id }).id, f.job.id)
})
test('request diagnostics survive reopen and cascade after deletion', t => {
  const directory = mkdtempSync(join(tmpdir(), 'chat-requests-')), path = join(directory, 'database.sqlite')
  let backend = composeBackend(openDatabase(path))
  t.after(() => { backend.close(); rmSync(directory, { recursive: true, force: true }) })
  const ids = backend.chats.start({ requestId: randomUUID(), message: 'Hello', choice })
  backend.chats.saveModelRequest(ids.runId, diagnostic(1))
  const snapshot = backend.chats.snapshot(ids.runId); snapshot.run.state = 'completed'; snapshot.run.finishedAt = new Date().toISOString(); backend.chats.finish(snapshot)
  backend.close(); backend = composeBackend(openDatabase(path))
  assert.equal(backend.chats.listModelRequests(ids.runId, 100, 0).items[0].verification, 'matched')
  backend.chats.deleteSession(ids.sessionId)
  assert.equal(backend.chats.listModelRequests(ids.runId, 100, 0).total, 0)
})
test('V14 is additive and preserves earlier migration checksums and audit definitions', () => {
  const db = new DatabaseSync(':memory:')
  try {
    migrate(db, migrations.slice(0, 13))
    const versions = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
    const auditSchema = db.prepare("SELECT * FROM sqlite_master WHERE name LIKE '%audit%' ORDER BY name").all()
    migrate(db, migrations.slice(0, 14))
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<=13 ORDER BY version').all(), versions)
    assert.deepEqual(db.prepare("SELECT * FROM sqlite_master WHERE name LIKE '%audit%' ORDER BY name").all(), auditSchema)
  } finally { db.close() }
})
