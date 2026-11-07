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
  assert.throws(() => database.connection.prepare('INSERT INTO agent_items SELECT ?,session_id,?,100,state,content_json,created_at,updated_at FROM agent_items WHERE run_id=? LIMIT 1').run(randomUUID(), b.runId, a.runId))
  assert.throws(() => database.connection.prepare('INSERT INTO agent_items SELECT ?,session_id,run_id,sequence,state,content_json,created_at,updated_at FROM agent_items LIMIT 1').run(randomUUID()))
  const done = repo.snapshot(next.runId); done.run.state = 'cancelled'; done.run.finishedAt = new Date().toISOString(); repo.finish(done)
  service.setModel({ id: a.sessionId, choice: { ...choice, modelId: 'other' } })
  assert.equal(repo.getRun(a.runId).modelId, 'model')
  service.deleteSession({ id: a.sessionId })
  assert.equal(database.connection.prepare('SELECT COUNT(*) n FROM agent_items WHERE session_id=?').get(a.sessionId)?.n, 0)
  assert.equal(database.connection.prepare('SELECT COUNT(*) n FROM agent_runs WHERE session_id=?').get(a.sessionId)?.n, 0)
  assert.equal(repo.listSessions(100, 0).total, 1)
})
test('recovery interrupts only abandoned owners, preserves checkpoint text and marks in-flight tools uncertain', t => {
  const database = openDatabase(':memory:'), backend = composeBackend(database), repo = backend.chats
  t.after(() => backend.close())
  const result = repo.start(start())
  repo.startCycle(result.runId, 1, 'start')
  repo.settleCycle(result.runId, 1, 'CONTINUE', null, 'end')
  repo.startCycle(result.runId, 2, 'start')
  repo.append(result.runId, { type: 'assistant_message', text: 'checkpoint' }, 'streaming')
  repo.append(result.runId, { type: 'tool_call', toolName: 'application.add_note', display: { key: 'addNote' } }, 'running')
  repo.recover(); assert.equal(repo.getRun(result.runId).state, 'running')
  database.connection.prepare('UPDATE runtime_instances SET expires_at=0 WHERE id=?').run(backend.lease.id)
  repo.recover()
  const snapshot = repo.snapshot(result.runId)
  assert.equal(snapshot.run.state, 'interrupted')
  assert.deepEqual(database.connection.prepare('SELECT status FROM agent_react_cycles WHERE run_id=? ORDER BY cycle_index').all(result.runId).map(row => row.status), ['CONTINUE', 'RUNNING'])
  assert.deepEqual(snapshot.items.map(i => i.state), ['completed', 'interrupted', 'uncertain'])
  assert.equal(snapshot.items[1].content.type !== 'tool_call' && snapshot.items[1].content.text, 'checkpoint')
})

function legacyPrompt(db: DatabaseSync, lease: ReturnType<typeof createRuntimeLease>, completed: boolean, smartPaste = false) {
  const sessionId = randomUUID(), runId = randomUUID(), userId = randomUUID()
  db.prepare('INSERT INTO chat_sessions VALUES(?,?,?,?,?,?)').run(sessionId, 'Legacy', choice.providerId, choice.modelId, 'start', 'end')
  db.prepare(`INSERT INTO chat_runs(id,session_id,provider_id,model_id,state,request_id,request_hash,owner_runtime_id,created_at,finished_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(runId, sessionId, choice.providerId, choice.modelId, completed ? 'completed' : 'running', randomUUID(), 'legacy', lease.id, 'start', completed ? 'end' : null)
  db.prepare('INSERT INTO chat_items VALUES(?,?,?,?,?,?,?,?)').run(userId, sessionId, runId, 1, 'completed',
    JSON.stringify({ type: 'user_message', text: 'Historical', ...(smartPaste ? { source: 'smart-paste' } : {}) }), 'start', 'end')
  if (completed) db.prepare('INSERT INTO chat_items VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), sessionId, runId, 2, 'completed',
    JSON.stringify({ type: 'assistant_message', text: 'Preserved answer' }), 'start', 'end')
  return { sessionId, runId, userId }
}

test('V13 preserves all legacy Memory phases and history, clears lifecycle flags and never restores their barrier', t => {
  const db = new DatabaseSync(':memory:')
  migrate(db, migrations.slice(0, 12))
  const lease = createRuntimeLease(db, 'internal'), repo = chatRepository(db, lease)
  t.after(() => { lease.close(); db.close() })
  const phases = ['pending', 'extracting', 'consolidating', 'committing', 'committed', 'no_change', 'failed']
  const runs = phases.map((phase, index) => {
    const ids = legacyPrompt(db, lease, true, index === 0)
    const value = JSON.stringify({ phase, writes: [{ path: 'legacy.md', content: 'Never replay', expectedRevision: null }], nextWrite: 0 })
    db.prepare('INSERT INTO chat_memory_progress VALUES(?,?,?,?)').run(ids.userId, ids.sessionId, 1, value)
    db.prepare('UPDATE chat_runs SET runtime_status=?,event_sequence=7 WHERE id=?').run(index % 2 ? 'memory.failed' : 'memory.updating', ids.runId)
    return ids
  })
  const interrupted = legacyPrompt(db, lease, false)
  const rows = db.prepare('SELECT * FROM chat_memory_progress ORDER BY message_id').all()
  const versions = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
  migrate(db)
  assert.deepEqual(db.prepare('SELECT * FROM chat_memory_progress ORDER BY message_id').all(), rows)
  assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<=12 ORDER BY version').all(), versions)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(db.prepare('SELECT source FROM agent_runs WHERE id=?').get(runs[0].runId)?.source, 'smart-paste')
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

test('V16 upgrades history without backfill and V17 protects and cascades the ordered Cycle sequence', t => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  migrate(db, migrations.slice(0, 15))
  const lease = createRuntimeLease(db, 'internal'), repo = chatRepository(db, lease)
  t.after(() => { lease.close(); db.close() })
  const old = legacyPrompt(db, lease, true)
  migrate(db, migrations.slice(0, 16))
  const checksum = db.prepare('SELECT checksum FROM schema_migrations WHERE version=16').get()
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_react_cycles').get()?.n, 0)
  migrate(db)
  assert.deepEqual(db.prepare('SELECT checksum FROM schema_migrations WHERE version=16').get(), checksum)
  assert.equal(repo.getRun(old.runId).state, 'completed')
  const next = repo.start(start(old.sessionId), true), { runId } = next
  assert.throws(() => repo.startCycle(runId, 1, 'start'))
  repo.admit(runId)
  assert.throws(() => repo.startCycle(runId, 2, 'gap'))
  repo.startCycle(runId, 1, 'start')
  assert.throws(() => repo.startCycle(runId, 2, 'overlap'))
  repo.settleCycle(runId, 1, 'WARNING', 'NO_PROGRESS_LOOP', 'end')
  assert.throws(() => repo.settleCycle(runId, 1, 'CONTINUE', null, 'later'))
  assert.throws(() => db.prepare("DELETE FROM agent_react_cycles WHERE run_id=?").run(runId))
  repo.startCycle(runId, 2, 'start')
  const done = repo.snapshot(runId)
  done.run.state = 'completed'; done.run.finishedAt = 'end'
  repo.finish(done, null)
  db.prepare("UPDATE agent_runs SET state='running',finished_at=NULL WHERE id=?").run(runId)
  assert.throws(() => repo.startCycle(runId, 3, 'after terminal'))
  db.prepare("UPDATE agent_runs SET state='completed',finished_at='end' WHERE id=?").run(runId)
  repo.deleteSession(old.sessionId)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_react_cycles').get()?.n, 0)
})

test('v19 preserves v18 Smart Paste history, provider capsules, model diagnostics and cycles', t => {
  const db = new DatabaseSync(':memory:')
  migrate(db, migrations.slice(0, 18))
  const lease = createRuntimeLease(db, 'internal')
  t.after(() => { lease.close(); db.close() })
  const { sessionId, runId } = legacyPrompt(db, lease, false, true)
  db.prepare("INSERT INTO chat_react_cycles(run_id,cycle_index,status,started_at) VALUES(?,1,'RUNNING','start')").run(runId)
  db.prepare("INSERT INTO chat_model_requests VALUES(?,1,'{}','[]')").run(runId)
  db.prepare("INSERT INTO chat_provider_responses VALUES(?,1,1,'{\"content\":\"legacy\",\"toolCalls\":[]}')").run(runId)
  db.prepare("UPDATE chat_react_cycles SET status='SUCCESS',finished_at='end',model_request_ordinal=1 WHERE run_id=?").run(runId)
  db.prepare("UPDATE chat_runs SET state='completed',finished_at='end',event_sequence=7 WHERE id=?").run(runId)
  db.prepare("INSERT INTO chat_context_checkpoints(session_id,summary,revision) VALUES(?,'legacy context',2)").run(sessionId)
  const journal = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
  const tables = [['chat_items', 'agent_items'], ['chat_react_cycles', 'agent_react_cycles'],
    ['chat_model_requests', 'agent_model_requests'], ['chat_provider_responses', 'agent_model_responses']]
  const before = tables.map(([table]) => db.prepare(`SELECT * FROM ${table}`).all())
  migrate(db)
  assert.deepEqual(tables.map(([, table]) => db.prepare(`SELECT * FROM ${table}`).all()), before)
  assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<=18 ORDER BY version').all(), journal)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(db.prepare('SELECT source FROM agent_runs WHERE id=?').get(runId)?.source, 'smart-paste')
  const repo = chatRepository(db, lease)
  assert.equal(repo.snapshot(runId).run.eventSequence, 7)
  assert.equal(repo.context(sessionId).summary, 'legacy context')
  assert.equal(repo.contextTurns(sessionId, 2)[0].messages.at(-1)?.content, 'legacy')
})
