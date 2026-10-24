import type { Result } from './ipc'

export const EXTERNAL_MCP_CALL = 'external-mcp:call'
export const externalMCPTargets = ['codex', 'claude-code', 'cursor'] as const
export type ExternalMCPTarget = typeof externalMCPTargets[number]
export type MCPConfigState = 'missing' | 'configured' | 'different' | 'invalid' | 'unavailable'
export const externalMCPErrors = ['INVALID_INPUT', 'FORBIDDEN', 'CONFIG_INVALID', 'CONFIG_UNAVAILABLE', 'CONFIG_CHANGED',
  'REPLACE_REQUIRED', 'RUNTIME_UNAVAILABLE', 'CONNECTION_FAILED', 'COPY_FAILED'] as const
export type ExternalMCPError = typeof externalMCPErrors[number]
export interface ExternalMCPStatus {
  target: ExternalMCPTarget
  path: string
  revision: string
  state: MCPConfigState
  config: string
  error?: ExternalMCPError
}
export interface ExternalMCPInspection { clients: ExternalMCPStatus[]; genericConfig: string }
export interface ExternalMCPInstall { target: ExternalMCPTarget; revision: string; replace: boolean }
export type ExternalMCPChange = Pick<ExternalMCPInstall, 'target' | 'revision'>
export interface ExternalMCPChangeResult { status: ExternalMCPStatus; backupPath?: string }
export interface ExternalMCPReconnectResult extends ExternalMCPChangeResult { toolCount?: number; error?: ExternalMCPError }
export interface ExternalMCPAPI {
  inspect(input: Record<string, never>): Promise<Result<ExternalMCPInspection, ExternalMCPError>>
  install(input: ExternalMCPInstall): Promise<Result<{ status: ExternalMCPStatus; backupPath?: string }, ExternalMCPError>>
  reconnect(input: ExternalMCPChange): Promise<Result<ExternalMCPReconnectResult, ExternalMCPError>>
  remove(input: ExternalMCPChange): Promise<Result<ExternalMCPChangeResult, ExternalMCPError>>
  test(input: { target: ExternalMCPTarget }): Promise<Result<{ toolCount: number }, ExternalMCPError>>
  copy(input: { target: ExternalMCPTarget | 'other' }): Promise<Result<null, ExternalMCPError>>
}
