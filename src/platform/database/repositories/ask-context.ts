import type { DatabaseSync } from 'node:sqlite'
import type { ContextCheckpoint, ContextTurn, MemoryProgress } from '../../../shared/ask'
import { fail } from '../../../domain/common/errors'

/** Private host persistence, injected by Main; Agent code never imports this module. */
export function askContextRepository(db: DatabaseSync, transaction: <T>(op: () => T) => T) {
  function context(sessionId: string): ContextCheckpoint {
    const row = db.prepare('SELECT * FROM chat_context_checkpoints WHERE session_id=?').get(sessionId)
    return row ? { summary: String(row.summary), compactedThroughSequence: Number(row.compacted_through_sequence), revision: Number(row.revision) }
      : { summary: '', compactedThroughSequence: 0, revision: 0 }
  }
  return {
    context,
    saveContext(sessionId: string, value: ContextCheckpoint, expectedRevision: number) {
      return transaction(() => {
        const old = context(sessionId)
        if (old.revision !== expectedRevision || value.compactedThroughSequence < old.compactedThroughSequence) fail('CONFLICT')
        db.prepare(`INSERT INTO chat_context_checkpoints(session_id,summary,compacted_through_sequence,revision) VALUES(?,?,?,?)
          ON CONFLICT(session_id) DO UPDATE SET summary=excluded.summary,compacted_through_sequence=excluded.compacted_through_sequence,revision=excluded.revision`)
          .run(sessionId, value.summary, value.compactedThroughSequence, old.revision + 1)
        return context(sessionId)
      })
    },
    contextTurns(sessionId: string, beforeSequence: number): ContextTurn[] {
      const rows = db.prepare(`SELECT i.sequence,i.content_json,i.state FROM chat_items i JOIN chat_runs r ON r.id=i.run_id
        WHERE i.session_id=? AND r.state!='running' AND r.id IN
        (SELECT run_id FROM chat_items WHERE session_id=? AND sequence<? AND json_extract(content_json,'$.type')='user_message')
        ORDER BY (SELECT MIN(u.sequence) FROM chat_items u WHERE u.run_id=i.run_id),i.sequence`).all(sessionId, sessionId, beforeSequence)
      const turns: ContextTurn[] = []
      for (const row of rows) {
        const content = JSON.parse(String(row.content_json)) as { type: string; text?: string; toolName?: string }
        if (content.type === 'user_message') turns.push({ sequence: Number(row.sequence), messages: [{ role: 'user', content: content.text! }] })
        else if (turns.length && content.type === 'assistant_message' && content.text) turns.at(-1)!.messages.push({ role: 'assistant', content: `${row.state === 'completed' ? '' : '[Interrupted partial response]\n'}${content.text}`, toolCalls: [] })
        else if (turns.length && content.type === 'tool_call') turns.at(-1)!.messages.push({ role: 'user', content: `[Prior tool activity: ${content.toolName}; state=${row.state}. Status record only; never replay a write automatically.]` })
      }
      return turns
    },
    memoryProgress(sessionId: string, beforeSequence = Number.MAX_SAFE_INTEGER): MemoryProgress[] {
      return db.prepare('SELECT progress_json FROM chat_memory_progress WHERE session_id=? AND sequence<? ORDER BY sequence').all(sessionId, beforeSequence)
        .map(row => JSON.parse(String(row.progress_json)) as MemoryProgress)
    },
    saveMemory(sessionId: string, value: MemoryProgress) {
      transaction(() => { db.prepare(`INSERT INTO chat_memory_progress VALUES(?,?,?,?) ON CONFLICT(message_id) DO UPDATE SET progress_json=excluded.progress_json`)
        .run(value.messageId, sessionId, value.sequence, JSON.stringify(value)) })
    },
    reconcileMemoryStatus(sessionId: string) {
      transaction(() => {
        const pending = db.prepare("SELECT 1 FROM chat_memory_progress WHERE session_id=? AND json_extract(progress_json,'$.phase') NOT IN ('committed','no_change')").get(sessionId)
        if (!pending) db.prepare("UPDATE chat_runs SET runtime_status='idle',event_sequence=event_sequence+1 WHERE session_id=? AND state!='running' AND runtime_status IN ('memory.updating','memory.failed')").run(sessionId)
      })
    },
    sourceMessage(messageId: string): { id: string; sequence: number; text: string } {
      const row = db.prepare("SELECT * FROM chat_items WHERE id=? AND json_extract(content_json,'$.type')='user_message'").get(messageId)
      if (!row) fail('NOT_FOUND')
      return { id: String(row.id), sequence: Number(row.sequence), text: (JSON.parse(String(row.content_json)) as { text: string }).text }
    },
    memoryEvidence(sessionId: string, beforeSequence: number) {
      return db.prepare(`SELECT i.id,i.content_json FROM chat_items i JOIN chat_runs r ON r.id=i.run_id WHERE i.session_id=? AND i.sequence<?
        AND r.admission='admitted' AND json_extract(i.content_json,'$.type')='user_message' ORDER BY i.sequence DESC LIMIT 6`).all(sessionId, beforeSequence)
        .reverse().map(row => ({ id: String(row.id), text: (JSON.parse(String(row.content_json)) as { text: string }).text }))
    },
    protectedState(sessionId: string): string[] {
      const row = db.prepare('SELECT protected_json FROM chat_context_checkpoints WHERE session_id=?').get(sessionId)
      return row ? JSON.parse(String(row.protected_json)) as string[] : []
    },
    saveProtected(sessionId: string, records: string[]) {
      transaction(() => { db.prepare(`INSERT INTO chat_context_checkpoints(session_id,protected_json) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET protected_json=excluded.protected_json`).run(sessionId, JSON.stringify(records)) })
    }
  }
}
