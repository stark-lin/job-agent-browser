import type { AgentTool } from '@earendil-works/pi-agent-core' with { 'resolution-mode': 'import' }
import { AgentError, abortable, type AgentToolDescriptor, type AgentTools, type StreamingAgentModel } from '../../../shared/agent'
import { ToolError } from '../../../shared/tools/errors'
import type { AskRuntimeStatus } from '../../../shared/ask'
import type { ContextBudget } from '../context/budget'
import type { ContextManager } from '../context/manager'
import type { AgentRuntimeEvent } from '../../../shared/agent'
import { isAskWrite } from '../tool-presentation'
import { ToolDiscovery } from '../tools/discovery'
import { createPiStream, piReasoning } from './model-adapter'

export async function runPiAsk(deps: {
  model: StreamingAgentModel; tools: AgentTools; system: string; message: string; signal: AbortSignal
  budget: ContextBudget; context: ContextManager; emit(event: AgentRuntimeEvent): void
  status(value: AskRuntimeStatus): void; protect(name: string, args: unknown, result: unknown, uncertain: boolean): void
}) {
  const { Agent } = await import('@earendil-works/pi-agent-core')
  let failure: unknown, serial = 0
  const failed = (error: unknown) => { failure ??= error }
  const registry = new ToolDiscovery(deps.tools, deps.budget, activation => {
    try { deps.emit({ type: 'model.request.activation', activation }) }
    catch (error) { failed(error); throw error }
  })
  await registry.refresh()
  const tool = (descriptor: AgentToolDescriptor): AgentTool => ({ name: descriptor.name, label: descriptor.name, description: descriptor.description, parameters: descriptor.inputSchema,
    async execute(_callId, args, signal) {
      const id = `tool-${++serial}`, began = Date.now(), combined = signal ? AbortSignal.any([signal, deps.signal]) : deps.signal
      deps.emit({ type: 'tool.started', id, call: { id: _callId, name: descriptor.name, arguments: args } })
      if (descriptor.name === 'tool.search') deps.status('tools.searching')
      if (descriptor.name === 'tool.activate') deps.status('tools.activating')
      try {
        const result = await abortable(registry.call(descriptor.name, args, combined), combined)
        deps.protect(descriptor.name, args, result, false)
        deps.emit({ type: 'tool.completed', id, name: descriptor.name, result, durationMs: Date.now() - began })
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
      } catch (error) {
        const code = error instanceof ToolError || error instanceof AgentError ? error.code : 'TOOL_EXECUTION_FAILED'
        const uncertain = isAskWrite(descriptor.name) && !['TOOL_CONFLICT', 'TOOL_INVALID_INPUT', 'TOOL_FORBIDDEN', 'TOOL_NOT_FOUND', 'TOOL_BUSY'].includes(code)
        const fatal = failure || uncertain || combined.aborted || error instanceof AgentError || ['TOOL_CANCELLED', 'TOOL_AUDIT_UNAVAILABLE', 'MCP_DISCONNECTED', 'TOOL_UNAVAILABLE'].includes(code)
        deps.protect(descriptor.name, args, null, uncertain)
        deps.emit({ type: 'tool.failed', id, name: descriptor.name, error: code, durationMs: Date.now() - began, uncertain })
        if (fatal) { failed(error); agent.abort() }
        return { content: [{ type: 'text', text: JSON.stringify({ error: code }) }], details: {}, isError: true }
      }
    } })
  const streamFn = await createPiStream({ model: deps.model, budget: deps.budget, signal: deps.signal, prepare: async (m, t, s) => { const messages = await deps.context.prepare(m, t, s); s.throwIfAborted(); deps.status('idle'); return messages }, failed,
    loadout: () => registry.snapshot(), advertised: names => registry.confirmRequest(names),
    completed: response => deps.emit({ type: 'model.completed', response }) })
  const agent = new Agent({ streamFn, toolExecution: 'sequential', initialState: {
    systemPrompt: deps.system, tools: registry.loadout().map(tool), thinkingLevel: 'off',
    model: { id: 'jab-model', name: 'JAB model', api: 'openai-completions', provider: 'jab', baseUrl: '', input: ['text'], reasoning: false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: deps.budget.capabilities.contextWindow, maxTokens: deps.budget.output }
  }, prepareNextTurnWithContext: async ({ context }) => {
    await registry.refresh()
    const tools = registry.loadout().map(tool); agent.state.tools = tools
    return { context: { ...context, tools } }
  }, beforeToolCall: async () => {
    if (failure || deps.signal.aborted) { agent.abort(); return { block: true, reason: 'AGENT_CANCELLED', terminate: true } }
    return undefined
  } })
  let segment: string | undefined
  agent.subscribe(event => {
    if (event.type !== 'message_update') return
    const update = event.assistantMessageEvent
    if (update.type === 'text_start' || update.type === 'thinking_start') {
      segment = `segment-${++serial}`; deps.emit({ type: 'segment.started', id: segment, kind: update.type === 'text_start' ? 'assistant_message' : 'reasoning',
        ...(update.type === 'thinking_start' ? { reasoning: piReasoning(update.partial.content[update.contentIndex]) } : {}) })
    }
    if ((update.type === 'text_delta' || update.type === 'thinking_delta') && segment) deps.emit({ type: 'segment.delta', id: segment, text: update.delta })
    if ((update.type === 'text_end' || update.type === 'thinking_end') && segment) { deps.emit({ type: 'segment.completed', id: segment }); segment = undefined }
  })
  const cancel = () => agent.abort()
  deps.signal.addEventListener('abort', cancel, { once: true })
  try {
    deps.signal.throwIfAborted()
    await abortable(agent.prompt(deps.message), deps.signal)
    if (failure) throw failure
    deps.signal.throwIfAborted()
    if (agent.state.errorMessage) throw new AgentError('AI_PROVIDER_FAILED')
  } finally { agent.abort(); await agent.waitForIdle(); deps.signal.removeEventListener('abort', cancel) }
}
