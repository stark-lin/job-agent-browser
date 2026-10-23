export const toolErrorCodes = ['TOOL_FORBIDDEN', 'TOOL_UNAVAILABLE', 'TOOL_CONFLICT', 'TOOL_INVALID_INPUT',
  'TOOL_INVALID_OUTPUT', 'TOOL_INVALID_CONFIG', 'TOOL_TIMEOUT', 'TOOL_CANCELLED', 'TOOL_EXECUTION_FAILED',
  'TOOL_UNSUPPORTED', 'TOOL_BUSY', 'TOOL_AUDIT_UNAVAILABLE', 'MCP_CONNECT_FAILED', 'MCP_INVALID_RESPONSE'] as const
export type ToolErrorCode = typeof toolErrorCodes[number]
export class ToolError extends Error {
  constructor(readonly code: ToolErrorCode) { super(code) }
}
export function toolFail(code: ToolErrorCode): never { throw new ToolError(code) }
export function toolError(error: unknown): ToolError {
  return error instanceof ToolError ? error : new ToolError('TOOL_EXECUTION_FAILED')
}
