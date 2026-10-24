import { abortable, AgentError, type AgentMessage, type AgentResponse, type AgentToolCall, type AgentTools, type StreamingAgentModel } from '../../shared/agent'
import { ToolError } from '../../shared/tools/errors'

export type StreamLoopEvent = { type: 'segment.started'; id: string; kind: 'reasoning' | 'assistant_message' }
  | { type: 'segment.delta'; id: string; text: string }
  | { type: 'segment.completed'; id: string }
  | { type: 'tool.started'; id: string; call: AgentToolCall }
  | { type: 'tool.completed'; id: string; name: string; result: unknown; durationMs: number }
  | { type: 'tool.failed'; id: string; name: string; error: string; durationMs: number; uncertain: boolean }

/** Bounded protocol-only loop. Host listeners own presentation and transcript persistence. */
export async function runStreamingAgent(model: StreamingAgentModel, tools: AgentTools, initial: AgentMessage[], signal: AbortSignal, emit: (event: StreamLoopEvent) => void): Promise<void> {
  const messages = structuredClone(initial), seen = new Set<string>(), descriptors = await abortable(tools.list(), signal)
  let serial = 0, contextBytes = 0
  for (let step = 0; step < 8; step++) {
    if (signal.aborted) throw new AgentError('AGENT_CANCELLED')
    let current: { id: string; kind: 'reasoning' | 'assistant_message' } | undefined, response: AgentResponse | undefined, content = ''
    const ready: AgentToolCall[] = []
    const iterator = model.stream({ messages: structuredClone(messages), tools: descriptors, signal })[Symbol.asyncIterator]()
    try {
      for (;;) {
        const next = await abortable(iterator.next(), signal)
        if (next.done) break
        const event = next.value
        if (response) throw new AgentError('AGENT_PROTOCOL_ERROR')
        if (event.type === 'content.delta' || event.type === 'reasoning.delta') {
          if (typeof event.text !== 'string') throw new AgentError('AGENT_PROTOCOL_ERROR')
          const kind = event.type === 'content.delta' ? 'assistant_message' : 'reasoning'
          if (kind === 'assistant_message') content += event.text
          if (current?.kind !== kind) {
            if (current) emit({ type: 'segment.completed', id: current.id })
            current = { id: `segment-${++serial}`, kind }; emit({ type: 'segment.started', ...current })
          }
          emit({ type: 'segment.delta', id: current.id, text: event.text })
        } else if (event.type === 'tool_call.ready') ready.push(event.call)
        else if (event.type === 'completed') response = event.response
        else throw new AgentError('AGENT_PROTOCOL_ERROR')
      }
    } finally { void iterator.return?.().catch(() => {}) }
    if (signal.aborted) throw new AgentError('AGENT_CANCELLED')
    if (!response || typeof response.content !== 'string' || response.content !== content || !Array.isArray(response.toolCalls) || response.toolCalls.length > 32
      || JSON.stringify(response.toolCalls) !== JSON.stringify(ready)) throw new AgentError('AGENT_PROTOCOL_ERROR')
    for (const call of response.toolCalls) {
      if (!call || typeof call.id !== 'string' || !call.id || seen.has(call.id) || !descriptors.some(d => d.name === call.name)
        || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) throw new AgentError('AGENT_PROTOCOL_ERROR')
      seen.add(call.id)
    }
    if (current) emit({ type: 'segment.completed', id: current.id })
    if (!response.toolCalls.length) {
      if (!content.trim()) throw new AgentError('AGENT_PROTOCOL_ERROR')
      return
    }
    messages.push({ role: 'assistant', ...structuredClone(response) })
    for (const call of response.toolCalls) {
      if (signal.aborted) throw new AgentError('AGENT_CANCELLED')
      const id = `tool-${++serial}`, began = Date.now()
      emit({ type: 'tool.started', id, call })
      let observation: string
      try {
        const result = await abortable(tools.call(call.name, call.arguments, signal), signal)
        // Success is recorded even when Stop races a committed business write.
        emit({ type: 'tool.completed', id, name: call.name, result, durationMs: Date.now() - began })
        observation = JSON.stringify(result)
      } catch (error) {
        const code = error instanceof ToolError ? error.code : 'TOOL_EXECUTION_FAILED'
        const fatal = signal.aborted || error instanceof AgentError || ['TOOL_CANCELLED', 'TOOL_AUDIT_UNAVAILABLE', 'MCP_DISCONNECTED', 'TOOL_UNAVAILABLE'].includes(code)
        emit({ type: 'tool.failed', id, name: call.name, error: code, durationMs: Date.now() - began, uncertain: fatal })
        if (fatal) throw error
        observation = JSON.stringify({ error: code })
      }
      contextBytes += new TextEncoder().encode(observation).length
      if (contextBytes > 2097152) throw new AgentError('AGENT_PROTOCOL_ERROR')
      if (signal.aborted) throw new AgentError('AGENT_CANCELLED')
      messages.push({ role: 'tool', callId: call.id, content: observation })
    }
  }
  throw new AgentError('AGENT_STEP_LIMIT')
}
