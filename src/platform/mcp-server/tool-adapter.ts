import type { ToolDescriptor, ToolOutput } from '../../shared/tools/tool.types'
import type { Tool, CallToolResult } from '@modelcontextprotocol/server'

export function mcpTool(tool: ToolDescriptor): Tool {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Tool['inputSchema'],
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema as Tool['outputSchema'] } : {}),
    annotations: { readOnlyHint: tool.mode === 'read', destructiveHint: tool.mode === 'write', openWorldHint: false } }
}
export function mcpResult(output: ToolOutput): CallToolResult {
  const encoded = output.structuredContent === undefined ? '' : JSON.stringify(output.structuredContent)
  return { ...output, ...(output.structuredContent === undefined ? {} : { structuredContent: output.structuredContent as Record<string, unknown>,
    content: output.content.length ? output.content : [{ type: 'text' as const,
      text: Buffer.byteLength(encoded) <= 524288 ? encoded : 'Complete result is available in structuredContent.' }] }) } as CallToolResult
}
