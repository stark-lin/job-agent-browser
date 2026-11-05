import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import Ajv from 'ajv'
import schemaV1 from '../src/domain/chat/chat-debug.v1.schema.json'
import schemaV2 from '../src/domain/chat/chat-debug.v2.schema.json'
import { fixture } from './helpers'
import { chatDebugExportRepository } from '../src/platform/database/repositories/chat-debug-export'

const choice = { providerId: 'fixture', modelId: 'test' }
const dump = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => [r.name, db.prepare(`SELECT * FROM "${r.name}" ORDER BY rowid`).all()])

test('raw export includes every column, all states and Pending, long JSON, over-page records and historical Memory without writes', t => {
  const f = fixture(t), db = f.database.connection, repo = chatDebugExportRepository(db)
  const ids = f.backend.chats.start({ requestId: randomUUID(), message: 'Initial', choice })
  const states = ['completed', 'failed', 'cancelled', 'interrupted'] as const
  let current = ids
  for (const state of states) {
    const snapshot = f.backend.chats.snapshot(current.runId)
    snapshot.run.state = state; snapshot.run.finishedAt = new Date().toISOString(); snapshot.run.error = state === 'failed' ? 'PRIVATE_ERROR' : null
    f.backend.chats.finish(snapshot)
    current = f.backend.chats.start({ requestId: randomUUID(), sessionId: ids.sessionId, message: state, choice })
  }
  for (let i = 0; i < 105; i++) f.backend.chats.start({ requestId: randomUUID(), sessionId: ids.sessionId, message: `Pending ${i}`, choice }, true)
  const other = f.backend.chats.start({ requestId: randomUUID(), message: 'OTHER_SESSION_SECRET', choice })
  const raw = '{ "type": "assistant_message", "text": ' + JSON.stringify('長文本🚀'.repeat(30000)) + ' }'
  for (let i = 0; i < 125; i++) {
    const item = f.backend.chats.append(current.runId, { type: 'assistant_message', text: '' }, i === 124 ? 'streaming' : 'completed')
    db.prepare('UPDATE chat_items SET content_json=? WHERE id=?').run(raw, item.id)
    db.prepare('INSERT INTO chat_memory_progress VALUES(?,?,?,?)').run(item.id, ids.sessionId, item.sequence, '{ "history": true }')
    // Reverse insertion order exercises explicit ordinal ordering.
    db.prepare('INSERT INTO chat_model_requests VALUES(?,?,?,?)').run(current.runId, 125 - i, '{ "ordinal": 0 }', '[  ]')
    db.prepare('INSERT INTO chat_provider_responses VALUES(?,?,?,?)').run(current.runId, 125 - i, item.sequence, '{ "capsule": "private" }')
  }
  f.backend.chats.startCycle(current.runId, 1, 'start-1')
  f.backend.chats.settleCycle(current.runId, 1, 'WARNING', 'NO_PROGRESS_LOOP', 'end-1')
  f.backend.chats.startCycle(current.runId, 2, 'start-2')
  f.backend.chats.saveProviderResponse(current.runId, { content: '', toolCalls: [{ id: 'call', name: 'job.list', arguments: {} }] }, 1, 2)
  db.prepare('INSERT INTO chat_context_checkpoints VALUES(?,?,?,?,?)').run(ids.sessionId, 'PRIVATE_SUMMARY', 9, 2, '[ "protected" ]')
  // Tie timestamps to verify the id tiebreaker rather than relying on insertion order.
  db.prepare('UPDATE chat_runs SET created_at=? WHERE session_id=?').run('2026-01-01T00:00:00.000Z', ids.sessionId)
  const before = dump(db), changes = db.prepare('SELECT total_changes() n').get()!.n
  const bundle = repo.getDebugBundle(ids.sessionId)
  assert.deepEqual(dump(db), before); assert.equal(db.prepare('SELECT total_changes() n').get()!.n, changes)
  assert.equal(db.isTransaction, false)
  const json = JSON.stringify(bundle)
  assert(!json.includes('OTHER_SESSION_SECRET')); assert(!json.includes(other.runId))
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value))
  const expected = (table: string, clause: string) => plain(db.prepare(`SELECT * FROM ${table} WHERE session_id=? ${clause}`).all(ids.sessionId))
  assert.deepEqual(plain(bundle.session), plain(db.prepare('SELECT * FROM chat_sessions WHERE id=?').get(ids.sessionId)))
  assert.deepEqual(plain(bundle.runs.map(r => r.run)), expected('chat_runs', 'ORDER BY created_at,id'))
  const flatItems = bundle.runs.flatMap(r => r.items).sort((a, b) => a.sequence - b.sequence)
  assert.deepEqual(plain(flatItems), expected('chat_items', 'ORDER BY sequence'))
  for (const run of bundle.runs) {
    for (const [key, table] of [['modelRequests', 'chat_model_requests'], ['providerResponses', 'chat_provider_responses']] as const) {
      assert.deepEqual(plain(run[key]), plain(db.prepare(`SELECT * FROM ${table} WHERE run_id=? ORDER BY ordinal`).all(run.run.id)))
    }
  }
  assert.deepEqual(plain(bundle.context.checkpoint), plain(db.prepare('SELECT * FROM chat_context_checkpoints WHERE session_id=?').get(ids.sessionId)))
  assert.deepEqual(plain(bundle.context.memoryProgress), expected('chat_memory_progress', 'ORDER BY sequence,message_id'))
  assert.equal(bundle.context.memoryProgress.length, 125)
  assert.equal(flatItems.at(-1)!.content_json, raw)
  assert(bundle.runs.some(r => r.run.state === 'running' && r.run.admission === 'pending'))
  for (const state of [...states, 'running']) assert(bundle.runs.some(r => r.run.state === state))
  const active = bundle.runs.find(run => run.run.id === current.runId)!
  assert.equal(active.cycleStatus, 'RUNNING')
  assert.deepEqual(active.cycles, [
    { index: 1, status: 'WARNING', reason: 'NO_PROGRESS_LOOP', modelRequestOrdinal: null, toolCallIds: [], startedAt: 'start-1', finishedAt: 'end-1' },
    { index: 2, status: 'RUNNING', reason: null, modelRequestOrdinal: null, toolCallIds: ['call'], startedAt: 'start-2', finishedAt: null }
  ])
  assert(bundle.runs.filter(run => run !== active).every(run => run.cycleStatus === null && run.cycles.length === 0))
  const envelope = { format: 'jab-debug', exportedAt: new Date().toISOString(), app: { version: '1', commit: null, platform: 'test' } }
  const ajv = new Ajv()
  const validators = { 1: ajv.compile(schemaV1), 2: ajv.compile(schemaV2) }
  const v1 = { ...envelope, schemaVersion: 1 as const, ...bundle, runs: bundle.runs.map(({ cycles, cycleStatus, ...run }) => run) }
  const v2 = { ...envelope, schemaVersion: 2 as const, ...bundle }
  for (const version of [v1, v2]) {
    const validate = validators[version.schemaVersion]
    assert(validate(version), JSON.stringify(validate.errors))
  }
  assert(!validators[1](v2))
  assert(!validators[2](v1))
  assert(bundle.runs.length > 100)
})

test('empty collections, absent checkpoint, missing session and read failure are read-only and release transactions', t => {
  const f = fixture(t), db = f.database.connection, repo = chatDebugExportRepository(db), id = randomUUID()
  db.prepare('INSERT INTO chat_sessions VALUES(?,?,?,?,?,?)').run(id, 'Empty', 'p', 'm', 'now', 'now')
  const before = dump(db)
  assert.deepEqual(JSON.parse(JSON.stringify(repo.getDebugBundle(id))), { session: { id, title: 'Empty', provider_id: 'p', model_id: 'm', created_at: 'now', updated_at: 'now' }, runs: [], context: { checkpoint: null, memoryProgress: [] } })
  assert.throws(() => repo.getDebugBundle(randomUUID()), { code: 'NOT_FOUND' })
  const prepare = db.prepare.bind(db)
  t.mock.method(db, 'prepare', ((sql: string) => { if (sql.includes('chat_runs')) throw new Error('PRIVATE_SQL_ERROR'); return prepare(sql) }) as typeof db.prepare)
  assert.throws(() => repo.getDebugBundle(id), { code: 'STORAGE_UNAVAILABLE' })
  t.mock.restoreAll()
  assert.equal(db.isTransaction, false); assert.deepEqual(dump(db), before)
  db.exec('BEGIN')
  assert.throws(() => repo.getDebugBundle(id), { code: 'INVALID_STATE' }); assert.equal(db.isTransaction, true)
  db.exec('ROLLBACK')
})

test('second WAL connection commits during export while all chat tables retain the first SELECT snapshot', t => {
  const directory = mkdtempSync(join(tmpdir(), 'debug-snapshot-')), path = join(directory, 'db.sqlite')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const f = fixture(t, path), db = f.database.connection
  const ids = f.backend.chats.start({ requestId: randomUUID(), message: 'before', choice })
  const repo = chatDebugExportRepository(db), before = repo.getDebugBundle(ids.sessionId), writer = new DatabaseSync(path)
  t.after(() => writer.close())
  const prepare = db.prepare.bind(db)
  let committed = false
  t.mock.method(db, 'prepare', ((sql: string) => {
    if (!committed && sql.startsWith('SELECT * FROM chat_runs')) {
      committed = true
      writer.exec('BEGIN IMMEDIATE')
      writer.prepare('UPDATE chat_sessions SET title=? WHERE id=?').run('after', ids.sessionId)
      writer.prepare('UPDATE chat_items SET content_json=? WHERE session_id=?').run('{"type":"user_message","text":"after"}', ids.sessionId)
      writer.prepare('INSERT INTO chat_context_checkpoints(session_id,summary) VALUES(?,?)').run(ids.sessionId, 'after')
      writer.prepare("INSERT INTO chat_react_cycles(run_id,cycle_index,status,started_at) VALUES(?,1,'RUNNING','after')").run(ids.runId)
      writer.exec('COMMIT')
    }
    return prepare(sql)
  }) as typeof db.prepare)
  assert.deepEqual(repo.getDebugBundle(ids.sessionId), before); assert(committed)
  t.mock.restoreAll()
  const after = repo.getDebugBundle(ids.sessionId)
  assert.equal(after.session.title, 'after')
  assert.equal(after.runs[0].cycleStatus, 'RUNNING')
})
