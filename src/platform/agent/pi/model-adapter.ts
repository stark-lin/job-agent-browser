import type { AssistantMessage, Message, ToolCall, Usage } from '@earendil-works/pi-ai' with { 'resolution-mode': 'import' }
import type { StreamFn } from '@earendil-works/pi-agent-core' with { 'resolution-mode': 'import' }
import { AgentError, abortable, type AgentMessage, type AgentResponse, type AgentToolCall, type AgentToolDescriptor, type StreamingAgentModel, type ProviderReasoning, type ReasoningInfo } from '../../../shared/agent'
import type { ContextBudget } from '../context/budget'
import { toolSnapshot, verifyRequest } from '../../ai/agent-request'

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })
type HostAssistant = AssistantMessage & { jabReasoning?: ProviderReasoning }
export const piReasoning = (block: unknown) => (block as { jabReasoning?: ReasoningInfo } | undefined)?.jabReasoning
const text = (content: Message['content']) => typeof content === 'string' ? content : content.filter(c => c.type === 'text').map(c => c.text).join('')
export function fromPi(messages: readonly Message[], system: string): AgentMessage[] {
  return [{ role: 'system', content: system }, ...messages.filter(m => m.role !== 'system').map((m): AgentMessage => {
    if (m.role === 'user') return { role: 'user', content: text(m.content) }
    if (m.role === 'toolResult') return { role: 'tool', callId: m.toolCallId, content: text(m.content) }
    return { role: 'assistant', content: text(m.content), ...((m as HostAssistant).jabReasoning ? { providerReasoning: (m as HostAssistant).jabReasoning } : {}), toolCalls: m.content.filter(c => c.type === 'toolCall').map(c => ({ id: c.id, name: c.name, arguments: c.arguments })) }
  })]
}

export async function createPiStream(deps: {
  model: StreamingAgentModel; budget: ContextBudget; signal: AbortSignal
  prepare(messages: AgentMessage[], tools: AgentToolDescriptor[], signal: AbortSignal): Promise<AgentMessage[]>
  failed(error: unknown): void
  completed?(response: AgentResponse): void
  loadout?(): { version: number; tools: AgentToolDescriptor[] }
  advertised?(names: string[]): void
}): Promise<StreamFn> {
  const { createAssistantMessageEventStream, getCurrentTools, getCurrentSystemPrompt } = await import('@earendil-works/pi-ai')
  const seen = new Set<string>()
  let requests = 0
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream()
    const partial: HostAssistant = { role: 'assistant', content: [], api: model.api, model: model.id, provider: model.provider, timestamp: Date.now(), usage: emptyUsage(), stopReason: 'pending' }
    void (async () => {
      try {
        const signal = options?.signal ? AbortSignal.any([options.signal, deps.signal]) : deps.signal
        if (++requests > 64) throw new AgentError('AGENT_STEP_LIMIT')
        signal.throwIfAborted()
        const tools: AgentToolDescriptor[] = getCurrentTools(context.messages).map(t => ({ name: t.name, description: t.description, inputSchema: t.parameters as Record<string, unknown> }))
        const messages = await deps.prepare(fromPi(context.messages, getCurrentSystemPrompt(context.messages)), tools, signal)
        const estimate = deps.budget.assert(messages, tools)
        let response: import('../../../shared/agent').AgentResponse | undefined
        const ready: AgentToolCall[] = []
        let content = '', current: { kind: 'text' | 'thinking'; index: number; value: string; reasoning?: ReasoningInfo } | undefined
        stream.push({ type: 'start', partial })
        function close() {
          if (!current) return
          stream.push({ type: current.kind === 'text' ? 'text_end' : 'thinking_end', contentIndex: current.index, content: current.value, partial })
          current = undefined
        }
        const loadout = deps.loadout?.() ?? { version: 0, tools }
        const requestContext = { purpose: 'agent-turn' as const, loadoutVersion: loadout.version, expectedTools: toolSnapshot(loadout.tools), piTools: toolSnapshot(tools) }
        const iterator = deps.model.stream({ messages, tools, signal, maxOutputTokens: deps.budget.output, stableToolNames: true, requestContext,
          onRequestPrepared(request) { verifyRequest(request, requestContext); deps.advertised?.(request.tools.map(t => t.name)) }, validateRequest(payload) {
          if (deps.budget.tokens.count(payload) > deps.budget.input) throw new AgentError('ASK_CONTEXT_OVERFLOW')
        } })[Symbol.asyncIterator]()
        try { for (;;) {
          const next = await abortable(iterator.next(), signal)
          if (next.done) break
          const event = next.value
          if (response) throw new AgentError('AGENT_PROTOCOL_ERROR')
          if (event.type === 'completed') response = event.response
          else if (event.type === 'tool_call.ready') ready.push(event.call)
          else {
            const kind = event.type === 'content.delta' ? 'text' : 'thinking'
            const reasoning = event.type === 'reasoning.delta' ? event.reasoning : undefined
            if (kind === 'text') content += event.text
            if (current?.kind !== kind || JSON.stringify(current?.reasoning) !== JSON.stringify(reasoning)) {
              close(); current = { kind, index: partial.content.length, value: '', reasoning }
              const block = kind === 'text' ? { type: 'text' as const, text: '' } : { type: 'thinking' as const, thinking: '', jabReasoning: reasoning }
              partial.content.push(block)
              stream.push({ type: kind === 'text' ? 'text_start' : 'thinking_start', contentIndex: current.index, partial })
            }
            current.value += event.text
            const block = partial.content[current.index]
            if (block.type === 'text') block.text += event.text
            if (block.type === 'thinking') block.thinking += event.text
            stream.push({ type: kind === 'text' ? 'text_delta' : 'thinking_delta', contentIndex: current.index, delta: event.text, partial })
          }
        } } finally { void iterator.return?.().catch(() => {}) }
        close(); signal.throwIfAborted()
        if (!response || response.content !== content || JSON.stringify(response.toolCalls) !== JSON.stringify(ready) || ready.length > 32
          || !ready.length && !content.trim()) throw new AgentError('AGENT_PROTOCOL_ERROR')
        for (const call of ready) {
          if (!call.id || seen.has(call.id) || !tools.some(t => t.name === call.name) || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) throw new AgentError('AGENT_PROTOCOL_ERROR')
          seen.add(call.id)
        }
        partial.jabReasoning = response.providerReasoning
        deps.completed?.(response)
        if (response.usage) {
          deps.budget.tokens.observe(estimate, response.usage.inputTokens)
          partial.usage = { ...emptyUsage(), input: response.usage.inputTokens, output: response.usage.outputTokens, totalTokens: response.usage.inputTokens + response.usage.outputTokens }
        }
        for (const call of ready) {
          const toolCall: ToolCall = { type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments as ToolCall['arguments'] }
          const index = partial.content.length; partial.content.push(toolCall)
          stream.push({ type: 'toolcall_start', contentIndex: index, partial })
          stream.push({ type: 'toolcall_end', contentIndex: index, toolCall, partial })
        }
        partial.stopReason = ready.length ? 'toolUse' : 'stop'
        stream.push({ type: 'done', reason: partial.stopReason, message: partial }); stream.end(partial)
      } catch (error) {
        deps.failed(error)
        partial.stopReason = deps.signal.aborted ? 'aborted' : 'error'; partial.errorMessage = error instanceof AgentError ? error.code : 'AI_PROVIDER_FAILED'
        stream.push({ type: 'error', reason: partial.stopReason, error: partial }); stream.end(partial)
      }
    })()
    return stream
  }
}
