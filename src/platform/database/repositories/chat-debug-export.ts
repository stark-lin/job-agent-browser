import type { DatabaseSync } from 'node:sqlite'
import type { ChatDebugData, ChatDebugRepository, DebugSession, DebugRun, DebugItem, DebugModelRequest, DebugProviderResponse, DebugCheckpoint, DebugMemoryProgress } from '../../../domain/chat/chat-debug.types'
import { fail } from '../../../domain/common/errors'
import { storageError } from '../errors'
import { reactCycle, type CycleRow } from './chat-react-cycles'

/** An explicit deferred read transaction pins all tables to the first SELECT snapshot. */
export function chatDebugExportRepository(db: DatabaseSync): ChatDebugRepository {
  return {
    getDebugBundle(sessionId): ChatDebugData {
      if (db.isTransaction) fail('INVALID_STATE')
      try {
        db.exec('BEGIN')
        const session = db.prepare('SELECT * FROM chat_sessions WHERE id=?').get(sessionId) as unknown as DebugSession | undefined
        if (!session) fail('NOT_FOUND')
        const runs = db.prepare('SELECT * FROM chat_runs WHERE session_id=? ORDER BY created_at,id').all(sessionId) as unknown as DebugRun[]
        const items = db.prepare('SELECT * FROM chat_items WHERE session_id=? ORDER BY sequence').all(sessionId) as unknown as DebugItem[]
        const modelRequests = db.prepare(`SELECT q.* FROM chat_model_requests q JOIN chat_runs r ON r.id=q.run_id
          WHERE r.session_id=? ORDER BY q.ordinal`).all(sessionId) as unknown as DebugModelRequest[]
        const providerResponses = db.prepare(`SELECT p.* FROM chat_provider_responses p JOIN chat_runs r ON r.id=p.run_id
          WHERE r.session_id=? ORDER BY p.ordinal`).all(sessionId) as unknown as DebugProviderResponse[]
        const cycles = db.prepare(`SELECT c.* FROM chat_react_cycles c JOIN chat_runs r ON r.id=c.run_id
          WHERE r.session_id=? ORDER BY c.cycle_index`).all(sessionId) as unknown as CycleRow[]
        const checkpoint = db.prepare('SELECT * FROM chat_context_checkpoints WHERE session_id=?').get(sessionId) as unknown as DebugCheckpoint | undefined
        const memoryProgress = db.prepare('SELECT * FROM chat_memory_progress WHERE session_id=? ORDER BY sequence,message_id').all(sessionId) as unknown as DebugMemoryProgress[]
        const group = <T extends { run_id: string }>(rows: T[]) => {
          const grouped = new Map<string, T[]>()
          for (const row of rows) { const values = grouped.get(row.run_id) ?? []; values.push(row); grouped.set(row.run_id, values) }
          return grouped
        }
        const byItem = group(items), byRequest = group(modelRequests), byResponse = group(providerResponses)
        const byCycle = group(cycles)
        const result = { session, runs: runs.map(run => {
          const ordered = (byCycle.get(run.id) ?? []).map(reactCycle)
          return { run, items: byItem.get(run.id) ?? [], modelRequests: byRequest.get(run.id) ?? [], providerResponses: byResponse.get(run.id) ?? [],
            cycles: ordered, cycleStatus: ordered.at(-1)?.status ?? null }
        }),
          context: { checkpoint: checkpoint ?? null, memoryProgress } }
        db.exec('COMMIT')
        return result
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw storageError(error) }
    }
  }
}
