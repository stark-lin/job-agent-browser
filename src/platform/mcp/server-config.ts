import { isAbsolute } from 'node:path'
import { toolFail } from '../../shared/tools/errors'
import { validateDescriptor } from '../../shared/tools/policy'
import type { JsonSchema, ToolDescriptor, ToolRisk } from '../../shared/tools/tool.types'
import { compileSchema, jsonCopy } from '../tools/schema'

export interface ReviewedMCPTool {
  name: string
  originalName: string
  description: string
  inputSchema: JsonSchema
  outputSchema?: JsonSchema
  risk: ToolRisk
  tags: string[]
}
export interface MCPServerConfig {
  id: string
  enabled: boolean
  transport: 'stdio'
  command: string
  args: string[]
  cwd?: string
  tools: ReviewedMCPTool[]
}
export interface MCPConfiguration { version: 1; servers: MCPServerConfig[] }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) toolFail('TOOL_INVALID_CONFIG')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max || value.includes('\0')) toolFail('TOOL_INVALID_CONFIG')
  return value
}
export function mcpDescriptor(serverId: string, tool: ReviewedMCPTool): ToolDescriptor {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}), risk: tool.risk,
    mode: tool.risk === 'READ' || tool.risk === 'COMPUTE' ? 'read' : 'write', tags: tool.tags,
    source: { type: 'mcp', serverId, originalName: tool.originalName } }
}
export function parseMCPConfiguration(input: unknown): MCPConfiguration {
  const value = object(jsonCopy(input, 1048576, 'TOOL_INVALID_CONFIG'), ['version', 'servers'])
  if (value.version !== 1 || !Array.isArray(value.servers) || value.servers.length > 16) toolFail('TOOL_INVALID_CONFIG')
  const ids = new Set<string>(), names = new Set<string>()
  const servers = value.servers.map(raw => {
    const server = object(raw, ['id', 'enabled', 'transport', 'command', 'args', 'cwd', 'tools'])
    const id = text(server.id, 64), command = text(server.command, 4096)
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || ids.has(id) || server.transport !== 'stdio' || typeof server.enabled !== 'boolean' ||
      !isAbsolute(command) || !Array.isArray(server.args) || server.args.length > 64 || !Array.isArray(server.tools) || server.tools.length > 128) toolFail('TOOL_INVALID_CONFIG')
    ids.add(id)
    const args = server.args.map(arg => typeof arg === 'string' && arg.length <= 4096 && !arg.includes('\0') ? arg : toolFail('TOOL_INVALID_CONFIG'))
    const cwd = server.cwd === undefined ? undefined : text(server.cwd, 4096)
    if (cwd !== undefined && !isAbsolute(cwd)) toolFail('TOOL_INVALID_CONFIG')
    const originals = new Set<string>()
    const tools = server.tools.map(rawTool => {
      const entry = object(rawTool, ['name', 'originalName', 'description', 'inputSchema', 'outputSchema', 'risk', 'tags'])
      const tool: ReviewedMCPTool = { name: text(entry.name, 128), originalName: text(entry.originalName, 128),
        description: text(entry.description, 4096), inputSchema: compileSchema(entry.inputSchema as JsonSchema, true).schema,
        ...(entry.outputSchema === undefined ? {} : { outputSchema: compileSchema(entry.outputSchema as JsonSchema).schema }),
        risk: entry.risk as ToolRisk, tags: entry.tags === undefined ? [] : entry.tags as string[] }
      validateDescriptor(mcpDescriptor(id, tool))
      // High-risk execution requires a future confirmation capability, never just a config edit.
      if (!['READ', 'COMPUTE'].includes(tool.risk) || names.has(tool.name) || originals.has(tool.originalName)) toolFail('TOOL_INVALID_CONFIG')
      names.add(tool.name); originals.add(tool.originalName)
      return tool
    })
    return { id, enabled: server.enabled, transport: 'stdio' as const, command, args, ...(cwd ? { cwd } : {}), tools }
  })
  return { version: 1, servers }
}
