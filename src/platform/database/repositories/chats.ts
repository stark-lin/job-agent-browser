import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import type { ChatChoice, ChatItem, ChatRun, ChatSession, ChatSnapshot, ChatStart } from '../../../domain/chat/chat.types'
import { fail } from '../../../domain/common/errors'
import { storageError } from '../errors'
import type { RuntimeLease } from '../runtime-leases'

type Row = Record<string, SQLOutputValue>
const session = (r: Row): ChatSession => ({ id: String(r.id), title: String(r.title), providerId: String(r.provider_id), modelId: String(r.model_id), createdAt: String(r.created_at), updatedAt: String(r.updated_at) })
const run = (r: Row): ChatRun => ({ id: String(r.id), sessionId: String(r.session_id), providerId: String(r.provider_id), modelId: String(r.model_id),
  state: r.state as ChatRun['state'], error: r.error === null ? null : String(r.error), eventSequence: Number(r.event_sequence), writeStarted: Boolean(r.write_started), createdAt: String(r.created_at), finishedAt: r.finished_at === null ? null : String(r.finished_at) })
const item = (r: Row): ChatItem => ({ id: String(r.id), sessionId: String(r.session_id), runId: String(r.run_id), sequence: Number(r.sequence), state: r.state as ChatItem['state'], content: JSON.parse(String(r.content_json)), createdAt: String(r.created_at), updatedAt: String(r.updated_at) })
const hash = (input: ChatStart) => createHash('sha256').update(JSON.stringify([input.sessionId ?? '', input.message.trim(), input.choice.providerId, input.choice.modelId])).digest('hex')

/** Main-owned recorder. No Agent module imports this repository or receives its methods. */
export function chatRepository(db: DatabaseSync, lease: RuntimeLease) {
  function transaction<T>(operation: () => T): T {
    if (db.isTransaction) fail('INVALID_STATE')
    try { db.exec('BEGIN IMMEDIATE'); const result = operation(); db.exec('COMMIT'); return result }
    catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw storageError(error) }
  }
  function read<T>(operation: () => T): T {
    try { db.exec('BEGIN'); const value = operation(); db.exec('COMMIT'); return value }
    catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw storageError(error) }
  }
  function getSession(id: string) { const row = db.prepare('SELECT * FROM chat_sessions WHERE id=?').get(id); if (!row) fail('NOT_FOUND'); return session(row) }
  function getRun(id: string) { const row = db.prepare('SELECT * FROM chat_runs WHERE id=?').get(id); if (!row) fail('NOT_FOUND'); return run(row) }
  function assertRunning(id: string) {
    lease.ensure()
    const row = db.prepare('SELECT owner_runtime_id,state FROM chat_runs WHERE id=?').get(id)
    if (!row || row.owner_runtime_id !== lease.id || row.state !== 'running') fail('CONFLICT')
  }
  function idle(id: string) { getSession(id); if (db.prepare("SELECT 1 FROM chat_runs WHERE session_id=? AND state='running'").get(id)) fail('INVALID_STATE') }
  function lookup(input: ChatStart) {
    const row = db.prepare('SELECT * FROM chat_runs WHERE request_id=?').get(input.requestId)
    if (!row) return null
    if (row.request_hash !== hash(input)) fail('CONFLICT')
    return { sessionId: String(row.session_id), runId: String(row.id) }
  }
  return {
    transaction, getSession, getRun, lookup,
    listSessions(limit: number, offset: number) {
      return read(() => ({ items: db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?').all(limit, offset).map(session), total: Number(db.prepare('SELECT COUNT(*) n FROM chat_sessions').get()!.n) }))
    },
    renameSession(id: string, title: string) {
      return transaction(() => { getSession(id); db.prepare('UPDATE chat_sessions SET title=? WHERE id=?').run(title, id); return getSession(id) })
    },
    setModel(id: string, choice: ChatChoice) {
      return transaction(() => { idle(id); db.prepare('UPDATE chat_sessions SET provider_id=?,model_id=? WHERE id=?').run(choice.providerId, choice.modelId, id); return getSession(id) })
    },
    deleteSession(id: string) { return transaction(() => { idle(id); db.prepare('DELETE FROM chat_sessions WHERE id=?').run(id); return null }) },
    listItems(sessionId: string, limit: number, before = Number.MAX_SAFE_INTEGER) {
      return read(() => ({ items: db.prepare('SELECT * FROM (SELECT * FROM chat_items WHERE session_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?) ORDER BY sequence').all(sessionId, before, limit).map(item),
        total: Number(db.prepare('SELECT COUNT(*) n FROM chat_items WHERE session_id=?').get(sessionId)!.n) }))
    },
    listRuns(sessionId: string, limit: number, offset: number) {
      return read(() => ({ items: db.prepare('SELECT * FROM chat_runs WHERE session_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(sessionId, limit, offset).map(run),
        total: Number(db.prepare('SELECT COUNT(*) n FROM chat_runs WHERE session_id=?').get(sessionId)!.n) }))
    },
    start(input: ChatStart) {
      return transaction(() => {
        lease.ensure()
        const previous = lookup(input); if (previous) return previous
        const now = new Date().toISOString(), sessionId = input.sessionId || randomUUID(), runId = randomUUID()
        if (input.sessionId) idle(sessionId)
        else db.prepare('INSERT INTO chat_sessions VALUES(?,?,?,?,?,?)').run(sessionId, [...input.message.trim()].slice(0, 48).join(''), input.choice.providerId, input.choice.modelId, now, now)
        db.prepare('INSERT INTO chat_runs(id,session_id,provider_id,model_id,state,request_id,request_hash,owner_runtime_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(runId, sessionId, input.choice.providerId, input.choice.modelId, 'running', input.requestId, hash(input), lease.id, now)
        const sequence = Number(db.prepare('SELECT COALESCE(MAX(sequence),0)+1 n FROM chat_items WHERE session_id=?').get(sessionId)!.n)
        db.prepare('INSERT INTO chat_items VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), sessionId, runId, sequence, 'completed', JSON.stringify({ type: 'user_message', text: input.message.trim() }), now, now)
        db.prepare('UPDATE chat_sessions SET provider_id=?,model_id=?,updated_at=? WHERE id=?').run(input.choice.providerId, input.choice.modelId, now, sessionId)
        return { sessionId, runId }
      })
    },
    snapshot(id: string): ChatSnapshot { return read(() => ({ run: getRun(id), items: db.prepare('SELECT * FROM chat_items WHERE run_id=? ORDER BY sequence').all(id).map(item) })) },
    append(id: string, content: ChatItem['content'], state: ChatItem['state']): ChatItem {
      return transaction(() => {
        assertRunning(id)
        const r = getRun(id), now = new Date().toISOString()
        const sequence = Number(db.prepare('SELECT COALESCE(MAX(sequence),0)+1 n FROM chat_items WHERE session_id=?').get(r.sessionId)!.n)
        const value: ChatItem = { id: randomUUID(), sessionId: r.sessionId, runId: id, sequence, content, state, createdAt: now, updatedAt: now }
        db.prepare('INSERT INTO chat_items VALUES(?,?,?,?,?,?,?,?)').run(value.id, value.sessionId, id, sequence, state, JSON.stringify(content), now, now)
        return value
      })
    },
    checkpoint(snapshot: ChatSnapshot) {
      transaction(() => {
        assertRunning(snapshot.run.id)
        for (const value of snapshot.items) db.prepare('UPDATE chat_items SET state=?,content_json=?,updated_at=? WHERE id=? AND run_id=?').run(value.state, JSON.stringify(value.content), value.updatedAt, value.id, snapshot.run.id)
        db.prepare('UPDATE chat_runs SET event_sequence=?,write_started=? WHERE id=?').run(snapshot.run.eventSequence, Number(snapshot.run.writeStarted), snapshot.run.id)
      })
    },
    finish(snapshot: ChatSnapshot) {
      transaction(() => {
        assertRunning(snapshot.run.id)
        for (const value of snapshot.items) db.prepare('UPDATE chat_items SET state=?,content_json=?,updated_at=? WHERE id=? AND run_id=?').run(value.state, JSON.stringify(value.content), value.updatedAt, value.id, snapshot.run.id)
        db.prepare('UPDATE chat_runs SET state=?,error=?,event_sequence=?,write_started=?,finished_at=? WHERE id=?').run(snapshot.run.state, snapshot.run.error, snapshot.run.eventSequence, Number(snapshot.run.writeStarted), snapshot.run.finishedAt, snapshot.run.id)
        db.prepare('UPDATE chat_sessions SET updated_at=? WHERE id=?').run(snapshot.run.finishedAt!, snapshot.run.sessionId)
      })
    },
    history(sessionId: string, beforeSequence: number, budget = 262144) {
      const rows = db.prepare(`SELECT i.* FROM chat_items i JOIN chat_runs r ON r.id=i.run_id WHERE i.session_id=? AND i.sequence<? AND i.state='completed'
        AND r.state='completed' AND json_extract(i.content_json,'$.type') IN ('user_message','assistant_message') ORDER BY i.sequence DESC LIMIT 40`).all(sessionId, beforeSequence).map(item).reverse()
      const messages: { role: 'user' | 'assistant'; content: string }[] = []
      let bytes = 0
      for (const value of rows.reverse()) {
        if (value.content.type === 'tool_call') continue
        bytes += Buffer.byteLength(value.content.text); if (bytes > budget) break
        messages.unshift({ role: value.content.type === 'user_message' ? 'user' : 'assistant', content: value.content.text })
      }
      while (messages.length && messages[0].role !== 'user') messages.shift()
      return messages
    },
    recover() {
      transaction(() => {
        const rows = db.prepare("SELECT id,owner_runtime_id FROM chat_runs WHERE state='running'").all()
        for (const row of rows) if (!lease.live(String(row.owner_runtime_id))) {
          const now = new Date().toISOString()
          db.prepare("UPDATE chat_items SET state=CASE WHEN json_extract(content_json,'$.type')='tool_call' THEN 'uncertain' ELSE 'interrupted' END,updated_at=? WHERE run_id=? AND state IN ('streaming','running')").run(now, row.id)
          db.prepare("UPDATE chat_runs SET state='interrupted',error='AGENT_INTERRUPTED',finished_at=? WHERE id=?").run(now, row.id)
          db.prepare('UPDATE chat_sessions SET updated_at=? WHERE id=(SELECT session_id FROM chat_runs WHERE id=?)').run(now, row.id)
        }
      })
    }
  }
}
export type ChatRecorder = ReturnType<typeof chatRepository>
