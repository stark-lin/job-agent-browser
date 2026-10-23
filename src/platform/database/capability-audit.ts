import type { DatabaseSync } from 'node:sqlite'
import { ToolError, toolErrorCodes, type ToolErrorCode } from '../../shared/tools/errors'
import { validateDescriptor } from '../../shared/tools/policy'
import type { CapabilityAudit, CapabilityAuditContext } from '../tools/audit.types'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export function createCapabilityAudit(db: DatabaseSync) {
  let writing = false
  db.function('capability_audit_allowed', () => writing ? 1 : 0)
  function write(operation: () => void) {
    if (db.isTransaction || writing) throw new ToolError('TOOL_AUDIT_UNAVAILABLE')
    writing = true
    try { db.exec('BEGIN IMMEDIATE'); operation(); db.exec('COMMIT') }
    catch { if (db.isTransaction) db.exec('ROLLBACK'); throw new ToolError('TOOL_AUDIT_UNAVAILABLE') }
    finally { writing = false }
  }
  function end(invocationId: string, duration: number, error: ToolErrorCode | null, interrupted = false) {
    const result = db.prepare(`INSERT INTO capability_audit(invocation_id,phase,timestamp,agent_id,run_id,tool_name,mode,
      server_id,original_name,target_type,target_id,duration_ms,status,error)
      SELECT invocation_id,'END',?,agent_id,run_id,tool_name,mode,server_id,original_name,target_type,target_id,?,?,?
      FROM capability_audit WHERE invocation_id=? AND phase='START'`).run(new Date().toISOString(), duration,
      interrupted ? 'INTERRUPTED' : error ? 'FAILURE' : 'SUCCESS', error, invocationId)
    if (result.changes !== 1) throw new ToolError('TOOL_AUDIT_UNAVAILABLE')
  }
  const sink: CapabilityAudit = {
    start(context: CapabilityAuditContext) {
      const { invocationId, agentId, runId, tool, target } = context
      validateDescriptor(tool)
      if (!uuid.test(invocationId) || !/^[a-z][a-z0-9_.-]{0,63}$/.test(agentId) || (runId !== undefined && !uuid.test(runId)) ||
        (target && (!['job', 'profile', 'artifact'].includes(target.type) || !uuid.test(target.id)))) throw new ToolError('TOOL_AUDIT_UNAVAILABLE')
      write(() => {
        db.prepare(`INSERT INTO capability_audit(invocation_id,phase,timestamp,agent_id,run_id,tool_name,mode,server_id,original_name,
          target_type,target_id,duration_ms,status,error) VALUES(?,'START',?,?,?,?,?,?,?,?,?,NULL,'STARTED',NULL)`)
          .run(invocationId, new Date().toISOString(), agentId, runId ?? null, tool.name, tool.mode,
            tool.source.type === 'mcp' ? tool.source.serverId : null, tool.source.type === 'mcp' ? tool.source.originalName : null,
            target?.type ?? null, target?.id ?? null)
      })
    },
    finish(context, durationMs, error) {
      if (!uuid.test(context.invocationId) || !Number.isSafeInteger(durationMs) || durationMs < 0 ||
        (error !== null && !toolErrorCodes.includes(error))) throw new ToolError('TOOL_AUDIT_UNAVAILABLE')
      write(() => end(context.invocationId, durationMs, error))
    }
  }
  return {
    sink,
    isWriting: () => writing,
    recoverInterrupted() {
      const unfinished = db.prepare(`SELECT s.invocation_id FROM capability_audit s WHERE s.phase='START' AND NOT EXISTS
        (SELECT 1 FROM capability_audit e WHERE e.invocation_id=s.invocation_id AND e.phase='END')`).all()
      if (unfinished.length) write(() => { for (const row of unfinished) end(String(row.invocation_id), 0, 'TOOL_UNAVAILABLE', true) })
    },
    // Main-only diagnostics; never exported through DataContract or a model tool.
    list() { return db.prepare('SELECT * FROM capability_audit ORDER BY sequence').all() }
  }
}
