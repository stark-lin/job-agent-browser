import { join } from 'node:path'
import { abortable, type AgentTools, type AgentToolDescriptor } from '../../shared/agent'
import { ToolError, toolErrorCodes, toolFail } from '../../shared/tools/errors'
import { jsonCopy, toolOutput } from '../tools/schema'
import { createMCPClient, type MCPClient } from './client'

export type FirstPartyAgent = 'resume' | 'job-capture' | 'application' | 'ask-ai'
export interface AgentBinding { runId?: string; jobId?: string }

/** The only production AgentTools implementation: all calls use the stdio Client. */
export class MCPAgentTools implements AgentTools {
  constructor(private readonly client: MCPClient, private readonly descriptors: readonly AgentToolDescriptor[],
    readonly signal: AbortSignal, private readonly binding: AgentBinding = {}) {}

  async list() { return structuredClone(this.descriptors) }
  close() { return this.client.close() }
  view(allow: readonly string[], binding: AgentBinding = {}) {
    return new MCPAgentTools(this.client, this.descriptors.filter(tool => allow.includes(tool.name)), this.signal, { ...this.binding, ...binding })
  }
  async call(name: string, args: unknown, signal: AbortSignal): Promise<unknown> {
    if (!this.descriptors.some(tool => tool.name === name)) toolFail('TOOL_FORBIDDEN')
    const input = jsonCopy(args, 1048576, 'TOOL_INVALID_INPUT')
    if (!input || typeof input !== 'object' || Array.isArray(input)) toolFail('TOOL_INVALID_INPUT')
    if (this.binding.runId && input.runId !== this.binding.runId) toolFail('TOOL_FORBIDDEN')
    if (this.binding.jobId && (name.startsWith('application.') ? input.jobId : input.id) !== this.binding.jobId) toolFail('TOOL_FORBIDDEN')
    const result = jsonCopy(await this.client.callTool(name, input, AbortSignal.any([signal, this.signal])), 1048576, 'MCP_INVALID_RESPONSE')
    if (!result || typeof result !== 'object' || Array.isArray(result)) toolFail('MCP_INVALID_RESPONSE')
    if (result.isError === true) {
      const items = result.content
      const item = Array.isArray(items) && items.length === 1 ? items[0] : null
      const code = item && typeof item === 'object' && !Array.isArray(item) && item.type === 'text' ? item.text : null
      throw new ToolError(toolErrorCodes.find(value => value === code) ?? 'TOOL_EXECUTION_FAILED')
    }
    if (!Object.hasOwn(result, 'structuredContent')) toolFail('MCP_INVALID_RESPONSE')
    return toolOutput({ content: result.content, structuredContent: result.structuredContent }).structuredContent
  }
}

/** One stable server session per workflow; a lost session is never used for run takeover. */
export function createFirstPartyRuntime(directory: string, bundleDirectory: string) {
  const sessions = new Map<FirstPartyAgent, Promise<MCPAgentTools>>()
  const clients = new Set<MCPClient>(), lifecycle = new AbortController()
  let disposed = false
  return {
    async session(agent: FirstPartyAgent, signal: AbortSignal): Promise<MCPAgentTools> {
      if (disposed) toolFail('TOOL_UNAVAILABLE')
      signal.throwIfAborted()
      let pending = sessions.get(agent)
      if (!pending) {
        const closed = new AbortController()
        let client: MCPClient
        client = createMCPClient({ id: `internal-${agent}`, enabled: true, transport: 'stdio', command: process.execPath,
          args: [join(bundleDirectory, 'job-agent-mcp.js')], tools: [] }, {
          closed() { closed.abort(new ToolError('TOOL_UNAVAILABLE')); clients.delete(client); if (sessions.get(agent) === pending) sessions.delete(agent) },
          changed() { closed.abort(new ToolError('MCP_INVALID_RESPONSE')); void client.close() }
        }, { processEnv: { ...(process.versions.electron ? { JOB_BROWSER_ELECTRON: process.execPath } : {}), JOB_BROWSER_USER_DATA: directory, JOB_BROWSER_MCP_CALLER: `internal.${agent}`, ELECTRON_RUN_AS_NODE: '1' } })
        clients.add(client)
        pending = (async () => {
          try {
            await client.connect(lifecycle.signal)
            const descriptors = await client.listTools(lifecycle.signal)
            if (new Set(descriptors.map(tool => tool.name)).size !== descriptors.length) toolFail('MCP_INVALID_RESPONSE')
            return new MCPAgentTools(client, descriptors, AbortSignal.any([closed.signal, lifecycle.signal]))
          } catch (error) { await client.close(); if (sessions.get(agent) === pending) sessions.delete(agent); throw error }
        })()
        sessions.set(agent, pending)
      }
      return abortable(pending, signal)
    },
    async dispose() {
      disposed = true; lifecycle.abort()
      await Promise.allSettled([...clients].map(client => client.close()))
      await Promise.allSettled(sessions.values()); sessions.clear()
    }
  }
}
export type FirstPartyRuntime = ReturnType<typeof createFirstPartyRuntime>
