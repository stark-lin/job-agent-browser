import type { DatabaseSync } from 'node:sqlite'
import type { ChatModelRequest } from '../../../domain/chat/chat.types'
import type { ActivationDiagnostic, RequestDiagnostic } from '../../../shared/agent'
import { fail } from '../../../domain/common/errors'

/** Main-owned private Agent request diagnostics. */
export function chatModelRequestsRepository(db: DatabaseSync, transaction: <T>(op: () => T) => T, assertRunning: (id: string) => void, read: <T>(op: () => T) => T, linkRequest: (runId: string, index: number, ordinal: number) => void) {
  return {
    saveModelRequest(runId: string, request: RequestDiagnostic, cycleIndex?: number) {
      transaction(() => {
        assertRunning(runId)
        if (cycleIndex !== undefined && request.purpose !== 'agent-turn') fail('INVALID_STATE')
        db.prepare('INSERT INTO agent_model_requests(run_id,ordinal,metadata_json) VALUES(?,?,?)').run(runId, request.ordinal, JSON.stringify(request))
        if (cycleIndex !== undefined) linkRequest(runId, cycleIndex, request.ordinal)
      })
    },
    saveActivationDiagnostic(runId: string, activation: ActivationDiagnostic) {
      transaction(() => {
        assertRunning(runId)
        const row = db.prepare("SELECT ordinal,activations_json FROM agent_model_requests WHERE run_id=? AND json_extract(metadata_json,'$.purpose')='agent-turn' ORDER BY ordinal DESC LIMIT 1").get(runId)
        if (!row) fail('INVALID_STATE')
        const activations = JSON.parse(String(row.activations_json)) as ActivationDiagnostic[]
        activations.push(activation)
        db.prepare('UPDATE agent_model_requests SET activations_json=? WHERE run_id=? AND ordinal=?').run(JSON.stringify(activations), runId, row.ordinal)
      })
    },
    listModelRequests(runId: string, limit: number, offset: number) {
      return read(() => ({ items: db.prepare('SELECT * FROM agent_model_requests WHERE run_id=? ORDER BY ordinal LIMIT ? OFFSET ?').all(runId, limit, offset)
        .map(row => ({ ...JSON.parse(String(row.metadata_json)), runId: String(row.run_id), activations: JSON.parse(String(row.activations_json)) }) as ChatModelRequest),
      total: Number(db.prepare('SELECT COUNT(*) n FROM agent_model_requests WHERE run_id=?').get(runId)!.n) }))
    }
  }
}
