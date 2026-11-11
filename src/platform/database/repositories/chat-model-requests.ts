import type { DatabaseSync } from 'node:sqlite'
import type { ChatModelRequest } from '../../../domain/chat/chat.types'
import type { AgentPhase, RequestDiagnostic } from '../../../shared/agent'
import { fail } from '../../../domain/common/errors'

/** Main-owned private Agent request diagnostics. */
export function chatModelRequestsRepository(db: DatabaseSync, transaction: <T>(op: () => T) => T, assertRunning: (id: string) => void, read: <T>(op: () => T) => T, linkRequest: (runId: string, index: number, ordinal: number) => void) {
  return {
    saveModelRequest(runId: string, request: RequestDiagnostic, cycleIndex?: number, phase: AgentPhase = 'execute') {
      transaction(() => {
        assertRunning(runId)
        if (cycleIndex !== undefined && request.purpose !== 'agent-turn') fail('INVALID_STATE')
        db.prepare('INSERT INTO agent_model_requests(run_id,ordinal,metadata_json,phase) VALUES(?,?,?,?)').run(runId, request.ordinal, JSON.stringify(request), phase)
        if (cycleIndex !== undefined) linkRequest(runId, cycleIndex, request.ordinal)
      })
    },
    listModelRequests(runId: string, limit: number, offset: number) {
      return read(() => ({ items: db.prepare('SELECT * FROM agent_model_requests WHERE run_id=? ORDER BY ordinal LIMIT ? OFFSET ?').all(runId, limit, offset)
        .map(row => ({ ...JSON.parse(String(row.metadata_json)), runId: String(row.run_id), phase: row.phase, activations: JSON.parse(String(row.activations_json)) }) as ChatModelRequest),
      total: Number(db.prepare('SELECT COUNT(*) n FROM agent_model_requests WHERE run_id=?').get(runId)!.n) }))
    }
  }
}
