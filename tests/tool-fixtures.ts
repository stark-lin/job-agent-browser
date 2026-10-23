import { resolve } from 'node:path'
import type { JsonSchema, ToolDescriptor, ToolCaller } from '../src/shared/tools/tool.types'
import { parseMCPConfiguration, type MCPServerConfig } from '../src/platform/mcp/server-config'

export const inputSchema: JsonSchema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }
export function descriptor(name = 'test.echo'): ToolDescriptor {
  return { name, description: 'Reviewed local description.', source: { type: 'native' }, mode: 'read', risk: 'READ', inputSchema, tags: [] }
}
export function caller(): ToolCaller { return { agentId: 'test-agent', signal: new AbortController().signal } }
export function serverConfig(names = ['echo'], id = 'fixture'): MCPServerConfig {
  return parseMCPConfiguration({ version: 1, servers: [{ id, enabled: true, transport: 'stdio', command: process.execPath,
    args: [resolve('tests/fixtures/mcp-server.mjs')], tools: names.map(name => ({ name: `${id}.${name}`, originalName: name,
      description: `Reviewed ${name}.`, risk: 'READ', inputSchema })) }] }).servers[0]
}
export async function until(predicate: () => boolean, message = 'Condition did not become true', timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
