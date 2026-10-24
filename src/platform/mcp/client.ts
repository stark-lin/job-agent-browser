import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { ToolError, toolFail } from '../../shared/tools/errors'
import type { JsonSchema } from '../../shared/tools/tool.types'
import { jsonCopy } from '../tools/schema'
import type { MCPServerConfig } from './server-config'
import { mcpError } from './errors'

export interface MCPDiscoveredTool { name: string; description: string; inputSchema: JsonSchema; outputSchema?: JsonSchema }
export interface MCPClient {
  connect(signal?: AbortSignal): Promise<void>
  listTools(signal?: AbortSignal): Promise<MCPDiscoveredTool[]>
  callTool(name: string, input: unknown, signal: AbortSignal): Promise<unknown>
  close(): Promise<void>
}
export interface ClientHooks { closed(): void; changed(): void }
export function createMCPClient(config: MCPServerConfig, hooks: ClientHooks, options: { connectMs?: number; discoveryMs?: number; processEnv?: Record<string, string> } = {}): MCPClient {
  let connected = false, closed = false, closing: Promise<void> | undefined, active = 0
  const lifecycle = new AbortController()
  const client = new Client({ name: 'job-agent-browser', version: '0.1.0' }, { listMaxPages: 16,
    inputRequired: { autoFulfill: false }, listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: () => hooks.changed() } } })
  const transport = new StdioClientTransport({ command: config.command, args: [...config.args], cwd: config.cwd,
    env: { ...(process.versions.electron && config.command === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {}), ...options.processEnv },
    stderr: 'ignore', maxBufferSize: 2097152 })
  client.onerror = () => {} // Errors are classified at request/connection boundaries, never printed raw.
  client.onclose = () => { connected = false; lifecycle.abort(); hooks.closed() }
  const signalFor = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, lifecycle.signal]) : lifecycle.signal
  return {
    async connect(signal) {
      if (closed) toolFail('TOOL_UNAVAILABLE')
      const timeout = AbortSignal.timeout(options.connectMs ?? 10000)
      try {
        await client.connect(transport, { signal: AbortSignal.any([signalFor(signal), timeout]), timeout: options.connectMs ?? 10000 })
        if (closed || signal?.aborted) toolFail('TOOL_CANCELLED')
        if (lifecycle.signal.aborted) toolFail('MCP_CONNECT_FAILED')
        connected = true
      } catch (error) {
        await client.close().catch(() => {})
        if (signal?.aborted || closed) toolFail('TOOL_CANCELLED')
        throw error instanceof ToolError ? error : new ToolError(timeout.aborted ? 'TOOL_TIMEOUT' : 'MCP_CONNECT_FAILED')
      }
    },
    async listTools(signal) {
      if (!connected || closed) toolFail('TOOL_UNAVAILABLE')
      const timeout = AbortSignal.timeout(options.discoveryMs ?? 10000)
      try {
        const result = await client.listTools(undefined, { signal: AbortSignal.any([signalFor(signal), timeout]), timeout: options.discoveryMs ?? 10000, cacheMode: 'refresh' })
        if (result.tools.length > 500) toolFail('MCP_INVALID_RESPONSE')
        jsonCopy(result.tools, 1048576, 'MCP_INVALID_RESPONSE')
        return result.tools.map(tool => ({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema as JsonSchema,
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema as JsonSchema } : {}) }))
      } catch (error) {
        if (timeout.aborted) toolFail('TOOL_TIMEOUT')
        if (signal?.aborted) toolFail('TOOL_CANCELLED')
        throw mcpError(error)
      }
    },
    async callTool(name, input, signal) {
      if (!connected || closed) toolFail('TOOL_UNAVAILABLE')
      if (signal.aborted) toolFail('TOOL_CANCELLED')
      if (active >= 4) toolFail('TOOL_BUSY')
      active++
      try {
        return await client.callTool({ name, arguments: input as Record<string, unknown> }, { signal: signalFor(signal), timeout: 120000, maxTotalTimeout: 120000 })
      } catch (error) { if (signal.aborted) toolFail('TOOL_CANCELLED'); throw mcpError(error) }
      finally { active-- }
    },
    close() {
      if (!closing) { closed = true; connected = false; lifecycle.abort(); closing = client.close().catch(() => {}) }
      return closing
    }
  }
}
