import type { AgentPhase } from '../../../shared/agent'
import type { DatabaseSync, StatementResultingChanges } from 'node:sqlite'
import { fail } from '../../../domain/common/errors'
import type { CycleStatus, ReActCycle, SettledCycleStatus } from '../../../shared/agent/react-cycle'

export interface CycleRow {
  run_id: string; phase: AgentPhase; cycle_index: number; status: CycleStatus; reason: string | null
  model_request_ordinal: number | null; tool_call_ids_json: string; started_at: string; finished_at: string | null
}

export function reactCycle(row: CycleRow): ReActCycle {
  return { index: row.cycle_index, phase: row.phase, status: row.status, reason: row.reason, modelRequestOrdinal: row.model_request_ordinal,
    toolCallIds: JSON.parse(row.tool_call_ids_json), startedAt: row.started_at, finishedAt: row.finished_at }
}

/** Call inside the Main recorder's write transactions. */
export function chatReactCycleWrites(db: DatabaseSync) {
  function requireCycle(result: StatementResultingChanges) {
    if (Number(result.changes) !== 1) fail('INVALID_STATE')
  }
  return {
    start(runId: string, index: number, startedAt: string, phase: AgentPhase) {
      db.prepare("INSERT INTO agent_react_cycles(run_id,cycle_index,status,started_at,phase) VALUES(?,?,'RUNNING',?,?)").run(runId, index, startedAt, phase)
    },
    linkRequest(runId: string, index: number, ordinal: number) {
      requireCycle(db.prepare(`UPDATE agent_react_cycles SET model_request_ordinal=?
        WHERE run_id=? AND cycle_index=? AND status='RUNNING' AND model_request_ordinal IS NULL`).run(ordinal, runId, index))
    },
    recordCalls(runId: string, index: number, ids: string[]) {
      requireCycle(db.prepare(`UPDATE agent_react_cycles SET tool_call_ids_json=?
        WHERE run_id=? AND cycle_index=? AND status='RUNNING'`).run(JSON.stringify(ids), runId, index))
    },
    settle(runId: string, index: number, status: SettledCycleStatus, reason: string | null, finishedAt: string) {
      requireCycle(db.prepare(`UPDATE agent_react_cycles SET status=?,reason=?,finished_at=?
        WHERE run_id=? AND cycle_index=? AND status='RUNNING'`).run(status, reason, finishedAt, runId, index))
    }
  }
}
