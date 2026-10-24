import { randomUUID } from 'node:crypto'
import { AgentError, abortable, type AgentModelEvent, type AgentModelInput, type AgentResponse } from '../../shared/agent'
import { DataError, type ErrorCode } from '../../domain/common/errors'
import type { ChatRequest, Fetch } from './compatible'
import { postChat, requestTimeout } from './transport'
import { parseAgentResponse, protocol, providerMessages, providerTools } from './agent-protocol'
import { sseFrames } from './sse'

type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : protocol()
interface PartialCall { id: string; type: string; function: { name: string; arguments: string } }

/** Only completed, validated and audited batches can expose executable tool calls. */
export async function* agentStream(config: Omit<ChatRequest, 'messages'>, deps: {
  audit(requestId: string, error: ErrorCode | null): void; transport?: Fetch; timeoutMs?: number
}, input: AgentModelInput): AsyncIterable<AgentModelEvent> {
  const timeout = requestTimeout(input.signal, deps.timeoutMs ?? config.timeoutMs), requestId = randomUUID()
  let failure: unknown, result: AgentResponse | undefined, finished: string | null = null, content = '', output = 0, done = false
  const calls = new Map<number, PartialCall>()
  try {
    const mapped = providerTools(input.tools)
    const reply = await abortable(postChat(config, { messages: providerMessages(input.messages, mapped.names), ...(mapped.tools.length ? { tools: mapped.tools } : {}) }, timeout.signal, true, deps.transport), timeout.signal)
    for await (const value of sseFrames(reply, timeout.signal)) {
      if (value === '[DONE]') { if (!finished) protocol(); done = true; break }
      const root = object(value)
      if (root.error) throw new AgentError('AI_PROVIDER_FAILED')
      if (!Array.isArray(root.choices) || root.choices.length > 1) protocol()
      if (!root.choices.length) continue
      if (finished) protocol()
      const choice = object(root.choices[0]), delta = object(choice.delta)
      if (choice.index !== undefined && choice.index !== 0 || delta.role !== undefined && delta.role !== 'assistant' || delta.function_call) protocol()
      for (const key of ['content', 'reasoning_summary'] as const) {
        if (delta[key] !== undefined && delta[key] !== null && typeof delta[key] !== 'string') protocol()
        const text = typeof delta[key] === 'string' ? delta[key] : ''
        if (text) {
          output += Buffer.byteLength(text); if (output > 1000000) protocol()
          if (key === 'content') content += text
          yield { type: key === 'content' ? 'content.delta' : 'reasoning.delta', text }
        }
      }
      // Unclassified reasoning/reasoning_content fields are not automatically display-safe.
      if (delta.tool_calls !== undefined) {
        if (!Array.isArray(delta.tool_calls) || delta.tool_calls.length > 32) protocol()
        for (const raw of delta.tool_calls) {
          const part = object(raw), index = part.index
          if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= 32) protocol()
          const call = calls.get(index) ?? { id: '', type: '', function: { name: '', arguments: '' } }
          if (part.id !== undefined) { if (typeof part.id !== 'string') protocol(); call.id += part.id }
          if (part.type !== undefined) { if (part.type !== 'function' || call.type && call.type !== part.type) protocol(); call.type = part.type }
          if (part.function !== undefined) {
            const fn = object(part.function)
            for (const key of ['name', 'arguments'] as const) if (fn[key] !== undefined) {
              if (typeof fn[key] !== 'string') protocol()
              call.function[key] += fn[key]
            }
          }
          if (call.id.length > 200 || call.function.name.length > 200 || Buffer.byteLength(call.function.arguments) > 1048576) protocol()
          calls.set(index, call)
        }
      }
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        if (!['stop', 'tool_calls'].includes(String(choice.finish_reason))) protocol()
        finished = String(choice.finish_reason)
      }
    }
    if (!finished || !done) protocol()
    const ordered = [...calls].sort(([a], [b]) => a - b)
    if (ordered.some(([index, call], position) => index !== position || ![...mapped.names.values()].includes(call.function.name))) protocol()
    result = parseAgentResponse({ choices: [{ finish_reason: finished, message: { role: 'assistant', content, tool_calls: ordered.map(([, call]) => call) } }] }, mapped.names)
    if (result.toolCalls.some(call => !mapped.names.has(call.name))) protocol()
    timeout.signal.throwIfAborted()
  } catch (error) {
    failure = input.signal.aborted ? new AgentError('AGENT_CANCELLED') : timeout.timedOut() ? new AgentError('AGENT_TIMEOUT')
      : error instanceof AgentError || error instanceof DataError ? error : new AgentError(error instanceof SyntaxError || error instanceof TypeError && String(error).includes('encoded') ? 'AGENT_PROTOCOL_ERROR' : 'AI_CONNECT_FAILED')
  } finally {
    timeout.dispose()
    const codes: Record<string, ErrorCode> = { AGENT_CANCELLED: 'AI_CANCELLED', AGENT_TIMEOUT: 'AI_TIMEOUT', AGENT_PROTOCOL_ERROR: 'AI_PROTOCOL_ERROR', AI_CONNECT_FAILED: 'AI_CONNECT_FAILED' }
    const code = failure instanceof DataError ? failure.code : failure instanceof AgentError ? codes[failure.code] ?? 'AI_PROVIDER_FAILED' : result ? null : 'AI_CANCELLED'
    try { deps.audit(requestId, code) } catch { throw new AgentError('AUDIT_UNAVAILABLE') }
  }
  if (failure) throw failure
  for (const call of result!.toolCalls) yield { type: 'tool_call.ready', call }
  yield { type: 'completed', response: result! }
}
