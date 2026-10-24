import test from 'node:test'
import assert from 'node:assert/strict'
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
