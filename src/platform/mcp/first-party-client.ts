import { parseRunGuard, type RunGuardSnapshot } from '../../shared/agent/run-guard'
import { createMemoryAuthority } from './memory-authority'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { abortable, type AgentTools, type AgentToolDescriptor } from '../../shared/agent'
import { ToolError, toolErrorCodes, toolFail } from '../../shared/tools/errors'
import { jsonCopy, toolOutput } from '../tools/schema'
import { createMCPClient, type MCPClient } from './client'

export type FirstPartyAgent = 'resume' | 'job-capture' | 'application' | 'ask-ai'
interface RunView { chatRunId: string; metadata(name: string, args: unknown): { jabRunGrant: string; jabMemoryGrant?: string }; snapshot?: RunGuardSnapshot }
export interface AgentBinding { runId?: string; jobId?: string }

/** The only production AgentTools implementation: all calls use the stdio Client. */
export class MCPAgentTools implements AgentTools {
  constructor(private readonly client: MCPClient, private readonly descriptors: readonly AgentToolDescriptor[],
    readonly signal: AbortSignal, private readonly binding: AgentBinding = {}, private readonly run?: RunView) {}

  withRun(signal: AbortSignal, run: RunView) {
    return new MCPAgentTools(this.client, this.descriptors, AbortSignal.any([signal, this.signal]), this.binding, run)
  }
  getRunGuardSnapshot() { return this.run?.snapshot && structuredClone(this.run.snapshot) }
  async list() { return structuredClone(this.descriptors) }
  close() { return this.client.close() }
  view(allow: readonly string[], binding: AgentBinding = {}) {
    return new MCPAgentTools(this.client, this.descriptors.filter(tool => allow.includes(tool.name)), this.signal, { ...this.binding, ...binding }, this.run)
  }
  async call(name: string, args: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.run) this.run.snapshot = undefined
    signal.throwIfAborted(); this.signal.throwIfAborted()
    if (!this.descriptors.some(tool => tool.name === name)) toolFail('TOOL_FORBIDDEN')
    const input = jsonCopy(args, 1048576, 'TOOL_INVALID_INPUT')
    if (!input || typeof input !== 'object' || Array.isArray(input)) toolFail('TOOL_INVALID_INPUT')
    if (this.binding.runId && input.runId !== this.binding.runId) toolFail('TOOL_FORBIDDEN')
    if (this.binding.jobId && (name.startsWith('application.') ? input.jobId : input.id) !== this.binding.jobId) toolFail('TOOL_FORBIDDEN')
    const result = jsonCopy(await this.client.callTool(name, input, AbortSignal.any([signal, this.signal]), this.run?.metadata(name, input)), 1048576, 'MCP_INVALID_RESPONSE')
    if (!result || typeof result !== 'object' || Array.isArray(result)) toolFail('MCP_INVALID_RESPONSE')
    if (this.run) {
      const metadata = result._meta
      const snapshot = parseRunGuard(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata.jabRunGuard : undefined)
      if (snapshot && snapshot.chatRunId !== this.run.chatRunId) toolFail('MCP_INVALID_RESPONSE')
      this.run.snapshot = snapshot
      if (!snapshot && result.isError !== true) toolFail('MCP_INVALID_RESPONSE')
    }
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
  const authority = createMemoryAuthority(directory)
  const sessions = new Map<string, Promise<{ tools: MCPAgentTools; authSession: string }>>()
  const clients = new Set<MCPClient>(), lifecycle = new AbortController()
  let disposed = false
  const runtime = {
    async session(agent: FirstPartyAgent, signal: AbortSignal, sessionId = 'default'): Promise<MCPAgentTools> {
      if (disposed) toolFail('TOOL_UNAVAILABLE')
      signal.throwIfAborted()
      const sessionKey = agent === 'ask-ai' ? `${agent}:${sessionId}` : agent
      let pending = sessions.get(sessionKey)
      if (!pending) {
        pending = (async () => {
          const closed = new AbortController()
          const authSession = `${sessionId}:${randomUUID()}`
          const launch = agent === 'ask-ai' ? await authority.issue(authSession) : undefined
          if (disposed) toolFail('TOOL_UNAVAILABLE')
          let client: MCPClient
          client = createMCPClient({ id: `internal-${agent}`, enabled: true, transport: 'stdio', command: process.execPath,
            args: [join(bundleDirectory, 'job-agent-mcp.js')], tools: [] }, {
            closed() { closed.abort(new ToolError('TOOL_UNAVAILABLE')); clients.delete(client); if (sessions.get(sessionKey) === pending) sessions.delete(sessionKey) },
            changed() { closed.abort(new ToolError('MCP_INVALID_RESPONSE')); void client.close() }
          }, { processEnv: { ...(process.versions.electron ? { JOB_BROWSER_ELECTRON: process.execPath } : {}), JOB_BROWSER_USER_DATA: directory, JOB_BROWSER_MCP_CALLER: `internal.${agent}`, ...(launch ? { JOB_BROWSER_MEMORY_LAUNCH: launch } : {}), ELECTRON_RUN_AS_NODE: '1' } })
          clients.add(client)
          try {
            await client.connect(lifecycle.signal)
            const descriptors = await client.listTools(lifecycle.signal)
            if (new Set(descriptors.map(tool => tool.name)).size !== descriptors.length) toolFail('MCP_INVALID_RESPONSE')
            return { tools: new MCPAgentTools(client, descriptors, AbortSignal.any([closed.signal, lifecycle.signal])), authSession }
          } catch (error) { await client.close(); if (sessions.get(sessionKey) === pending) sessions.delete(sessionKey); throw error }
        })()
        sessions.set(sessionKey, pending)
      }
      const { tools } = await abortable(pending, signal)
      return tools
    },
    async openAskRun(input: { chatRunId: string; sessionId: string; sourceMessageIds: string[]; signal: AbortSignal }) {
      const tools = await runtime.session('ask-ai', input.signal, input.sessionId)
      const pending = sessions.get(`ask-ai:${input.sessionId}`)
      if (!pending) toolFail('TOOL_UNAVAILABLE')
      const { authSession } = await pending
      input.signal.throwIfAborted(); tools.signal.throwIfAborted()
      const stopped = new AbortController()
      const registered = authority.registerRun(authSession, input.chatRunId, input.sessionId), sources = [...input.sourceMessageIds]
      let closing: Promise<void> | undefined
      const close = () => { stopped.abort(); return closing ??= registered.close().catch(async () => { await tools.close(); throw new ToolError('TOOL_UNAVAILABLE') }).finally(() => input.signal.removeEventListener('abort', cancel)) }
      const cancel = () => { void close().catch(() => {}) }
      input.signal.addEventListener('abort', cancel, { once: true })
      if (input.signal.aborted) { cancel(); input.signal.throwIfAborted() }
      const view = tools.withRun(AbortSignal.any([input.signal, stopped.signal]), { chatRunId: input.chatRunId, metadata(name, args) {
        input.signal.throwIfAborted()
        return { jabRunGrant: registered.grant(name, args), ...(['memory.write', 'memory.mkdir'].includes(name) && sources.length
          ? { jabMemoryGrant: authority.grant(authSession, name, args, sources) } : {}) }
      } })
      return { tools: view, close }
    },
    async dispose() {
      disposed = true; lifecycle.abort()
      await Promise.allSettled([...clients].map(client => client.close()))
      await Promise.allSettled(sessions.values()); sessions.clear(); await authority.close()
    }
  }
  return runtime
}
export type FirstPartyRuntime = ReturnType<typeof createFirstPartyRuntime>
