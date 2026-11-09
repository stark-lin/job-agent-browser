import { parseRunGuard, type RunGuardSnapshot } from '../../shared/agent/run-guard'
import { resumeAgentLifecycle, resumeAgentTools } from '../../shared/agent/resume-policy'
import { createRunAdmission } from './run-admission'
import { createAdmissionBroker } from './run-admission-broker'
import { createMemoryAuthority } from './memory-authority'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { abortable, type AgentTools, type AgentToolDescriptor } from '../../shared/agent'
import { ToolError, toolErrorCodes, toolFail } from '../../shared/tools/errors'
import { jsonCopy, toolOutput } from '../tools/schema'
import { createMCPClient, type MCPClient } from './client'

export type FirstPartyAgent = 'resume' | 'job-capture' | 'application' | 'ask-ai'
interface RunView { executionRunId: string; metadata(name: string, args: unknown): { jabRunGrant: string; jabMemoryGrant?: string }; snapshot?: RunGuardSnapshot; unguarded?: boolean }
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
    if (this.binding.runId && name.startsWith('resume.') && input.runId !== this.binding.runId) toolFail('TOOL_FORBIDDEN')
    if (this.binding.jobId && (name.startsWith('application.') ? input.jobId : input.id) !== this.binding.jobId) toolFail('TOOL_FORBIDDEN')
    const result = jsonCopy(await this.client.callTool(name, input, AbortSignal.any([signal, this.signal]), this.run?.metadata(name, input)), 1048576, 'MCP_INVALID_RESPONSE')
    if (!result || typeof result !== 'object' || Array.isArray(result)) toolFail('MCP_INVALID_RESPONSE')
    if (this.run && !this.run.unguarded) {
      const metadata = result._meta
      const snapshot = parseRunGuard(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata.jabRunGuard : undefined)
      if (snapshot && snapshot.executionRunId !== this.run.executionRunId) toolFail('MCP_INVALID_RESPONSE')
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

const askSessionKey = (id: string, readOnly?: boolean) => `ask-ai:${readOnly ? 'read-only:' : ''}${id}`

/** One stable server session per workflow; a lost session is never used for run takeover. */
export function createFirstPartyRuntime(directory: string, bundleDirectory: string) {
  const admission = createRunAdmission(), broker = createAdmissionBroker(directory, admission)
  const authority = createMemoryAuthority(directory, admission)
  const sessions = new Map<string, Promise<{ tools: MCPAgentTools; authSession: string; raw?: MCPAgentTools }>>()
  const closures = new Map<string, Promise<void>>()
  const clients = new Set<MCPClient>(), lifecycle = new AbortController()
  let disposed = false
  const runtime = {
    ready: broker.ready,
    async session(agent: FirstPartyAgent, signal: AbortSignal, sessionId = 'default', readOnly = false): Promise<MCPAgentTools> {
      if (disposed) toolFail('TOOL_UNAVAILABLE')
      signal.throwIfAborted()
      const sessionKey = agent === 'ask-ai' ? askSessionKey(sessionId, readOnly) : agent === 'resume' ? `resume:${sessionId}` : agent
      let pending = sessions.get(sessionKey)
      if (!pending) {
        pending = (async () => {
          const closed = new AbortController()
          const authSession = `${sessionId}:${randomUUID()}`
          const launch = await authority.issue(authSession, agent === 'resume' ? 'resume' : agent === 'ask-ai' ? 'ask' : 'business')
          if (disposed) toolFail('TOOL_UNAVAILABLE')
          let client: MCPClient
          client = createMCPClient({ id: `internal-${agent}`, enabled: true, transport: 'stdio', command: process.execPath,
            args: [join(bundleDirectory, 'job-agent-mcp.js')], tools: [] }, {
            closed() { authority.retireSession(authSession); closed.abort(new ToolError('TOOL_UNAVAILABLE')); clients.delete(client); if (sessions.get(sessionKey) === pending) sessions.delete(sessionKey) },
            changed() { closed.abort(new ToolError('MCP_INVALID_RESPONSE')); void client.close() }
          }, { processEnv: { ...(process.versions.electron ? { JOB_BROWSER_ELECTRON: process.execPath } : {}), JOB_BROWSER_USER_DATA: directory, JOB_BROWSER_MCP_CALLER: `internal.${agent}`, ...(launch ? { JOB_BROWSER_MEMORY_LAUNCH: launch } : {}), JOB_BROWSER_ASK_READ_ONLY: readOnly ? '1' : '0', ELECTRON_RUN_AS_NODE: '1' } })
          clients.add(client)
          try {
            await client.connect(lifecycle.signal)
            const descriptors = await client.listTools(lifecycle.signal)
            if (new Set(descriptors.map(tool => tool.name)).size !== descriptors.length) toolFail('MCP_INVALID_RESPONSE')
            const tools = new MCPAgentTools(client, descriptors, AbortSignal.any([closed.signal, lifecycle.signal]))
            if (agent === 'ask-ai') return { tools, authSession }
            if (agent !== 'resume') {
              const business = authority.registerRun(authSession, undefined, sessionId, { kind: 'business' })
              return { authSession, tools: tools.withRun(tools.signal, { executionRunId: business.executionRunId, metadata: (name, args) => ({ jabRunGrant: business.grant(name, args) }) }) }
            }
            const controller = authority.registerRun(authSession, undefined, sessionId, { kind: 'resume-controller' })
            return { authSession, tools: tools.withRun(tools.signal, { executionRunId: controller.executionRunId, unguarded: true,
              metadata: (name, args) => ({ jabRunGrant: controller.grant(name, args) }) }).view(resumeAgentLifecycle), raw: tools }
          } catch (error) { await client.close(); if (sessions.get(sessionKey) === pending) sessions.delete(sessionKey); throw error }
        })()
        sessions.set(sessionKey, pending)
      }
      const { tools } = await abortable(pending, signal)
      return tools
    },
    async openAgentRun(input: { agent: 'ask' | 'resume'; agentRunId: string; sessionId: string; generationRunId?: string; sourceMessageIds?: string[]; signal: AbortSignal; readOnly?: boolean }) {
      const ask = input.agent === 'ask'
      const connection = ask ? runtime.session('ask-ai', input.signal, input.sessionId, input.readOnly) : undefined
      const pending = sessions.get(ask ? askSessionKey(input.sessionId, input.readOnly) : `resume:${input.sessionId}`)
      let tools: MCPAgentTools, authSession: string, registered: ReturnType<typeof authority.registerRun>
      try {
        if (!pending) { await connection; toolFail('TOOL_UNAVAILABLE') }
        const [entry] = await Promise.all([abortable(pending, input.signal), connection])
        authSession = entry.authSession
        tools = ask ? entry.tools : entry.raw!.view(resumeAgentTools, { runId: input.generationRunId })
        await closures.get(authSession)
        input.signal.throwIfAborted(); tools.signal.throwIfAborted()
        registered = authority.registerRun(authSession, input.agentRunId, input.sessionId, { kind: input.agent, generationRunId: input.generationRunId })
      } catch (error) {
        if (input.readOnly) void pending?.then(({ tools }) => tools.close()).catch(() => {})
        throw error
      }
      const stopped = new AbortController(), sources = [...(input.sourceMessageIds ?? [])]
      let closing: Promise<void> | undefined
      const close = () => {
        stopped.abort()
        if (closing) return closing
        closing = registered.close().then(async () => {
          if (input.readOnly) await tools.close()
        }).catch(async () => {
          await tools.close()
          throw new ToolError('TOOL_UNAVAILABLE')
        }).finally(() => { input.signal.removeEventListener('abort', cancel); if (closures.get(authSession) === closing) closures.delete(authSession) })
        closures.set(authSession, closing)
        return closing
      }
      const cancel = () => { void close().catch(() => {}) }
      input.signal.addEventListener('abort', cancel, { once: true })
      if (input.signal.aborted) { cancel(); input.signal.throwIfAborted() }
      const view = tools.withRun(AbortSignal.any([input.signal, stopped.signal]), { executionRunId: registered.executionRunId, metadata(name, args) {
        input.signal.throwIfAborted()
        return { jabRunGrant: registered.grant(name, args), ...(ask && !input.readOnly && ['memory.write', 'memory.mkdir'].includes(name) && sources.length
          ? { jabMemoryGrant: authority.grant(authSession, name, args, sources) } : {}) }
      } })
      return { tools: view, signal: view.signal, close }
    },
    async dispose() {
      disposed = true; lifecycle.abort()
      await Promise.allSettled([...clients].map(client => client.close()))
      await Promise.allSettled(sessions.values()); sessions.clear(); await authority.close(); await broker.close()
    }
  }
  return runtime
}
export type FirstPartyRuntime = ReturnType<typeof createFirstPartyRuntime>
