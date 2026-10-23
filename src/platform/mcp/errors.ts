import { SdkError, SdkErrorCode } from '@modelcontextprotocol/client'
import { ToolError, toolError } from '../../shared/tools/errors'

/** No SDK object, process message, arguments, physical path or server body crosses this boundary. */
export function mcpError(error: unknown): ToolError {
  if (error instanceof SdkError) {
    switch (error.code) {
      case SdkErrorCode.RequestTimeout: return new ToolError('TOOL_TIMEOUT')
      case SdkErrorCode.ConnectionClosed:
      case SdkErrorCode.NotConnected: return new ToolError('TOOL_UNAVAILABLE')
      case SdkErrorCode.UnsupportedResultType:
      case SdkErrorCode.CapabilityNotSupported: return new ToolError('TOOL_UNSUPPORTED')
      case SdkErrorCode.InvalidResult:
      case SdkErrorCode.ListPaginationExceeded: return new ToolError('MCP_INVALID_RESPONSE')
    }
  }
  return toolError(error)
}
