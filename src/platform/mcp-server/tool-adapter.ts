import type { ToolDescriptor, ToolOutput } from '../../shared/tools/tool.types'
import type { Tool, CallToolResult } from '@modelcontextprotocol/server'

export function mcpTool(tool: ToolDescriptor, external = false): Tool {
  const schema = tool.inputSchema as Tool['inputSchema']
  const inputSchema = external ? { ...schema, properties: { ...schema.properties, executionRunId: { type: 'string', format: 'uuid', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' } }, required: [...(schema.required ?? []), 'executionRunId'] } : schema
  return { name: tool.name, description: tool.description, inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema as Tool['outputSchema'] } : {}),
    annotations: { readOnlyHint: tool.mode === 'read', destructiveHint: tool.mode === 'write', openWorldHint: false }, _meta: { jabRisk: tool.risk } }
}
export function mcpResult(output: ToolOutput): CallToolResult {
  const encoded = output.structuredContent === undefined ? '' : JSON.stringify(output.structuredContent)
  return { ...output, ...(output.structuredContent === undefined ? {} : { structuredContent: output.structuredContent as Record<string, unknown>,
    content: output.content.length ? output.content : [{ type: 'text' as const,
      text: Buffer.byteLength(encoded) <= 524288 ? encoded : 'Complete result is available in structuredContent.' }] }) } as CallToolResult
}

export const controlTools: Tool[] = [
  { name: 'run.begin', description: 'Begin one execution in the running JAB Main. Returns a server-generated runId. Successful business calls persist immediately; there is no commit or rollback.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'run.end', description: 'Close this session’s execution and release admission after in-flight tools settle. Previously saved writes remain saved. Allowed even when the guard is blocked.', inputSchema: { type: 'object', properties: { runId: { type: 'string', format: 'uuid' } }, required: ['runId'], additionalProperties: false } }
]
