import type { composeBackend } from '../database/backend'
import type { JsonSchema, JsonValue } from '../../shared/tools/tool.types'
import { DataError } from '../../domain/common/errors'
import { ToolError } from '../../shared/tools/errors'

export function businessTool(backend: ReturnType<typeof composeBackend>, name: string, description: string, inputSchema: JsonSchema,
  write: boolean, operation: (input: Record<string, unknown>) => unknown, targetKey?: string, inputLimit = 65536, targetType: 'job' | 'profile' | 'artifact' = 'job') {
  return backend.capabilities[write ? 'write' : 'read']({ name, description, inputSchema, source: { type: 'native' }, tags: [name.split('.')[0]],
    mode: write ? 'write' : 'read', risk: write ? 'WRITE' : 'READ' }, input => {
    try { return { content: [], structuredContent: operation(input as Record<string, unknown>) as JsonValue } }
    catch (error) {
      if (!(error instanceof DataError)) throw error
      throw new ToolError(error.code === 'INVALID_INPUT' ? 'TOOL_INVALID_INPUT' : error.code === 'FORBIDDEN' ? 'TOOL_FORBIDDEN'
        : ['INVALID_STATE', 'CONFLICT'].includes(error.code) ? 'TOOL_CONFLICT' : error.code === 'STORAGE_BUSY' ? 'TOOL_BUSY'
        : error.code === 'AUDIT_UNAVAILABLE' ? 'TOOL_AUDIT_UNAVAILABLE' : 'TOOL_EXECUTION_FAILED')
    }
  }, { inputLimit, target: targetKey ? input => ({ type: targetType, id: String((input as Record<string, unknown>)[targetKey]) }) : undefined })
}
