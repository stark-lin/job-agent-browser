import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrate, migrations } from '../src/platform/database/migrations'
import { createRuntimeLease } from '../src/platform/database/runtime-leases'
import { chatRepository } from '../src/platform/database/repositories/chats'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../src/platform/database/sqlite'
import { composeBackend } from '../src/platform/database/backend'
import { createChatService } from '../src/domain/chat/chat.service'

const choice = { providerId: 'fixture', modelId: 'model' }
const start = (sessionId?: string) => ({ requestId: randomUUID(), sessionId, message: 'Hello 中文', choice })
test('chat persistence is atomic, idempotent, ordered, paginated and constrained across sessions', t => {
  const database = openDatabase(':memory:'), backend = composeBackend(database), repo = backend.chats, service = createChatService(repo)
  t.after(() => backend.close())
  const input = start(), a = repo.start(input)
  assert.deepEqual(repo.start(input), a)
  assert.throws(() => repo.start({ ...input, message: 'Different' }), { code: 'CONFLICT' })
  assert.throws(() => repo.start(start(a.sessionId)), { code: 'INVALID_STATE' })
  const snapshot = repo.snapshot(a.runId)
  assert.equal(snapshot.items[0].sequence, 1)
  const assistant = repo.append(a.runId, { type: 'assistant_message', text: 'Answer' }, 'completed')
  snapshot.items.push(assistant); snapshot.run.state = 'completed'; snapshot.run.finishedAt = new Date().toISOString(); repo.finish(snapshot)
  const next = repo.start(start(a.sessionId)); assert.equal(repo.snapshot(next.runId).items[0].sequence, 3)
  const b = repo.start(start()); assert.equal(service.listSessions({ limit: 1 }).total, 2)
  assert.equal(service.listItems({ sessionId: a.sessionId, limit: 1 }).items[0].sequence, 3)
  assert.equal(service.listItems({ sessionId: a.sessionId, beforeSequence: 3 }).items.at(-1)?.sequence, 2)
  assert.equal(service.renameSession({ id: a.sessionId, title: 'Renamed' }).title, 'Renamed')
  assert.throws(() => service.deleteSession({ id: a.sessionId }), { code: 'INVALID_STATE' })
  assert.throws(() => service.setModel({ id: a.sessionId, choice }), { code: 'INVALID_STATE' })
  assert.throws(() => database.connection.prepare('INSERT INTO chat_items SELECT ?,session_id,?,100,state,content_json,created_at,updated_at FROM chat_items WHERE run_id=? LIMIT 1').run(randomUUID(), b.runId, a.runId))
  assert.throws(() => database.connection.prepare('INSERT INTO chat_items SELECT ?,session_id,run_id,sequence,state,content_json,created_at,updated_at FROM chat_items LIMIT 1').run(randomUUID()))
  const done = repo.snapshot(next.runId); done.run.state = 'cancelled'; done.run.finishedAt = new Date().toISOString(); repo.finish(done)
  service.setModel({ id: a.sessionId, choice: { ...choice, modelId: 'other' } })
  assert.equal(repo.getRun(a.runId).modelId, 'model')
  service.deleteSession({ id: a.sessionId })
  assert.equal(database.connection.prepare('SELECT COUNT(*) n FROM chat_items WHERE session_id=?').get(a.sessionId)?.n, 0)
  assert.equal(database.connection.prepare('SELECT COUNT(*) n FROM chat_runs WHERE session_id=?').get(a.sessionId)?.n, 0)
  assert.equal(repo.listSessions(100, 0).total, 1)
})
test('recovery interrupts only abandoned owners, preserves checkpoint text and marks in-flight tools uncertain', t => {
  const database = openDatabase(':memory:'), backend = composeBackend(database), repo = backend.chats
  t.after(() => backend.close())
  const result = repo.start(start())
  repo.append(result.runId, { type: 'assistant_message', text: 'checkpoint' }, 'streaming')
  repo.append(result.runId, { type: 'tool_call', toolName: 'application.add_note', display: { key: 'addNote' } }, 'running')
  repo.recover(); assert.equal(repo.getRun(result.runId).state, 'running')
  database.connection.prepare('UPDATE runtime_instances SET expires_at=0 WHERE id=?').run(backend.lease.id)
  repo.recover()
  const snapshot = repo.snapshot(result.runId)
  assert.equal(snapshot.run.state, 'interrupted')
  assert.deepEqual(snapshot.items.map(i => i.state), ['completed', 'interrupted', 'uncertain'])
  assert.equal(snapshot.items[1].content.type !== 'tool_call' && snapshot.items[1].content.text, 'checkpoint')
})

test('V13 preserves all legacy Memory phases and history, clears lifecycle flags and never restores their barrier', t => {
  const db = new DatabaseSync(':memory:')
  migrate(db, migrations.slice(0, 12))
  const lease = createRuntimeLease(db, 'internal'), repo = chatRepository(db, lease)
  t.after(() => { lease.close(); db.close() })
  const phases = ['pending', 'extracting', 'consolidating', 'committing', 'committed', 'no_change', 'failed']
  const runs = phases.map((phase, index) => {
    const ids = repo.start(start()), snapshot = repo.snapshot(ids.runId), user = snapshot.items[0]
    snapshot.items.push(repo.append(ids.runId, { type: 'assistant_message', text: 'Preserved answer' }, 'completed'))
    snapshot.run.state = 'completed'; snapshot.run.finishedAt = new Date().toISOString(); repo.finish(snapshot)
    const value = JSON.stringify({ phase, writes: [{ path: 'legacy.md', content: 'Never replay', expectedRevision: null }], nextWrite: 0 })
    db.prepare('INSERT INTO chat_memory_progress VALUES(?,?,?,?)').run(user.id, ids.sessionId, user.sequence, value)
    db.prepare('UPDATE chat_runs SET runtime_status=?,event_sequence=7 WHERE id=?').run(index % 2 ? 'memory.failed' : 'memory.updating', ids.runId)
    return ids
  })
  const interrupted = repo.start(start())
  const rows = db.prepare('SELECT * FROM chat_memory_progress ORDER BY message_id').all()
  const versions = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
  migrate(db)
  assert.deepEqual(db.prepare('SELECT * FROM chat_memory_progress ORDER BY message_id').all(), rows)
  assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<=12 ORDER BY version').all(), versions)
  for (const ids of runs) {
    const run = repo.getRun(ids.runId)
    assert.equal(run.state, 'completed'); assert.equal(run.runtimeStatus, 'idle'); assert.equal(run.eventSequence, 8)
    assert.equal(repo.snapshot(ids.runId).items.at(-1)?.state, 'completed')
    assert(repo.start(start(ids.sessionId)).runId)
  }
  db.prepare('UPDATE runtime_instances SET expires_at=0 WHERE id=?').run(lease.id)
  repo.recover()
  assert.equal(repo.getRun(interrupted.runId).state, 'interrupted')
  assert.equal(repo.getRun(interrupted.runId).runtimeStatus, 'idle')
})
