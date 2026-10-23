import { createHash } from 'node:crypto'
import { toolFail } from '../../shared/tools/errors'
import type { JsonValue, ToolOutput } from '../../shared/tools/tool.types'
import { jsonCopy, limits } from '../tools/schema'

/** Property order is immaterial; any actual schema change invalidates the review. */
export function schemaFingerprint(schema: unknown): string {
  const value = jsonCopy(schema, limits.schema, 'MCP_INVALID_RESPONSE')
  const canonical = (item: JsonValue): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`
    if (item && typeof item === 'object') return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
    return JSON.stringify(item)
  }
  return createHash('sha256').update(canonical(value)).digest('hex')
}
export function adaptMCPResult(input: unknown): ToolOutput {
  const result = jsonCopy(input, limits.output, 'MCP_INVALID_RESPONSE')
  if (!result || typeof result !== 'object' || Array.isArray(result)) toolFail('MCP_INVALID_RESPONSE')
  if (result.resultType !== undefined && result.resultType !== 'complete') toolFail('TOOL_UNSUPPORTED')
  if (result.isError === true) toolFail('TOOL_EXECUTION_FAILED')
  if (!Array.isArray(result.content)) toolFail('MCP_INVALID_RESPONSE')
  const content = result.content.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || item.type !== 'text' || typeof item.text !== 'string') toolFail('TOOL_UNSUPPORTED')
    return { type: 'text' as const, text: item.text }
  })
  return { content, ...(Object.hasOwn(result, 'structuredContent') ? { structuredContent: result.structuredContent } : {}) }
}
