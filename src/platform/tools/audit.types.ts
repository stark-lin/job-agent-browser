import type { ToolErrorCode } from '../../shared/tools/errors'
import type { ToolDescriptor } from '../../shared/tools/tool.types'

export interface CapabilityAuditContext {
  invocationId: string
  agentId: string
  runId?: string
  tool: ToolDescriptor
  target?: { type: 'job' | 'profile' | 'artifact'; id: string }
}
export interface CapabilityAudit {
  start(context: CapabilityAuditContext): void
  finish(context: CapabilityAuditContext, durationMs: number, error: ToolErrorCode | null): void
}
