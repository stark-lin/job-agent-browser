import { randomUUID } from 'node:crypto'
import { AgentError, abortable, type AgentErrorCode, type AgentMessage, type AgentModel, type AgentResponse } from '../../shared/agent'
import type { ToolDescriptor } from '../../shared/tools/tool.types'
import type { ChatRequest, Fetch } from '../ai/compatible'
import { postChat, requestTimeout } from '../ai/transport'
import { DataError, type ErrorCode } from '../../domain/common/errors'

function protocol(): never { throw new AgentError('AGENT_PROTOCOL_ERROR') }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : protocol()
/** Index mapping is injective, deterministic and independent of punctuation in business names. */
export function providerTools(tools: readonly ToolDescriptor[]) {
  const names = new Map(tools.map((tool, index) => [tool.name, `tool_${index}`]))
  if (names.size !== tools.length) protocol()
  return { names, tools: tools.map(tool => ({ type: 'function', function: { name: names.get(tool.name), description: tool.description, parameters: tool.inputSchema } })) }
}
function messages(input: readonly AgentMessage[], names: Map<string, string>) {
  return input.map(message => {
    if (message.role === 'tool') return { role: 'tool', tool_call_id: message.callId, content: message.content }
    if (message.role !== 'assistant') return message
    return { role: 'assistant', content: message.content || null, ...(message.toolCalls.length ? { tool_calls: message.toolCalls.map(call => ({
      id: call.id, type: 'function', function: { name: names.get(call.name) ?? call.name, arguments: JSON.stringify(call.arguments) }
    })) } : {}) }
  })
}
function response(value: unknown, names: Map<string, string>): AgentResponse {
  const root = object(value)
  if (root.error || !Array.isArray(root.choices) || root.choices.length !== 1) protocol()
  const choice = object(root.choices[0]), message = object(choice.message)
  if (message.role !== 'assistant' || message.function_call || (message.content !== null && message.content !== undefined && typeof message.content !== 'string')) protocol()
  const raw = message.tool_calls ?? []
  if (!Array.isArray(raw) || raw.length > 32 || !['stop', 'tool_calls'].includes(String(choice.finish_reason)) || (raw.length > 0) !== (choice.finish_reason === 'tool_calls')) protocol()
  const seen = new Set<string>()
  const toolCalls = raw.map(value => {
    const call = object(value), fn = object(call.function)
    if (call.type !== 'function' || typeof call.id !== 'string' || !call.id || call.id.length > 200 || seen.has(call.id) || typeof fn.name !== 'string' || typeof fn.arguments !== 'string') protocol()
    seen.add(call.id)
    let args: unknown
    try { args = JSON.parse(fn.arguments) } catch { return protocol() }
    const name = [...names].find(([, mapped]) => mapped === fn.name)?.[0] ?? fn.name
    return { id: call.id, name, arguments: args }
  })
  const content = typeof message.content === 'string' ? message.content : ''
  if (!toolCalls.length && !content.trim()) protocol()
  return { content, toolCalls }
}
export function compatibleAgentModel(config: Omit<ChatRequest, 'messages'>, deps: {
  audit(requestId: string, error: ErrorCode | null): void; transport?: Fetch; timeoutMs?: number
}): AgentModel {
  const snapshot = structuredClone(config)
  return { async complete(input) {
    const timeout = requestTimeout(input.signal, deps.timeoutMs ?? snapshot.timeoutMs), requestId = randomUUID()
    let result: AgentResponse | undefined, failure: unknown
    try {
      const mapped = providerTools(input.tools)
      const pending = (async () => {
        const reply = await postChat(snapshot, { messages: messages(input.messages, mapped.names), ...(mapped.tools.length ? { tools: mapped.tools } : {}) }, timeout.signal, false, deps.transport)
        if (!reply.headers.get('content-type')?.toLowerCase().includes('application/json')) { await reply.body?.cancel(); protocol() }
        const reader = reply.body?.getReader()
        if (!reader) protocol()
        const chunks: Uint8Array[] = []; let length = 0
        try {
          for (;;) {
            const part = await reader.read(); if (part.done) break
            length += part.value.length; if (length > 1000000) protocol()
            chunks.push(part.value)
          }
          return response(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))), mapped.names)
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      })()
      result = await abortable(pending, timeout.signal)
      timeout.signal.throwIfAborted()
    } catch (error) {
      failure = input.signal.aborted ? new AgentError('AGENT_CANCELLED') : timeout.timedOut() ? new AgentError('AGENT_TIMEOUT')
        : error instanceof AgentError || error instanceof DataError ? error : new AgentError(error instanceof SyntaxError || error instanceof TypeError && String(error).includes('encoded') ? 'AGENT_PROTOCOL_ERROR' : 'AI_CONNECT_FAILED')
    } finally { timeout.dispose() }
    const auditErrors: Partial<Record<AgentErrorCode, ErrorCode>> = { AGENT_CANCELLED: 'AI_CANCELLED', AGENT_TIMEOUT: 'AI_TIMEOUT', AGENT_PROTOCOL_ERROR: 'AI_PROTOCOL_ERROR', AI_CONNECT_FAILED: 'AI_CONNECT_FAILED' }
    const auditCode = failure instanceof DataError ? failure.code : failure instanceof AgentError ? auditErrors[failure.code] ?? 'AI_PROVIDER_FAILED' : null
    try { deps.audit(requestId, auditCode) } catch { throw new AgentError('AUDIT_UNAVAILABLE') }
    if (failure) throw failure
    return result!
  } }
}
