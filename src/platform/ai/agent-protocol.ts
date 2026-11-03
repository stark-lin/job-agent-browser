import type { AgentMessage, AgentResponse, AgentToolDescriptor } from '../../shared/agent'
import { AgentError } from '../../shared/agent'
import { createHash } from 'node:crypto'
import { ReasoningAccumulator } from './reasoning'

export function protocol(): never { throw new AgentError('AGENT_PROTOCOL_ERROR') }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : protocol()
/** Keep business names recognizable while distinguishing punctuation and truncated slugs. */
export const stableName = (name: string) => `tool_${name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}_${createHash('sha256').update(name).digest('hex').slice(0, 10)}`
export function providerTools(tools: readonly AgentToolDescriptor[], stable = false) {
  const names = new Map(tools.map((tool, index) => [tool.name, stable ? stableName(tool.name) : `tool_${index}`]))
  if (names.size !== tools.length || new Set(names.values()).size !== tools.length) protocol()
  return { names, tools: tools.map(tool => ({ type: 'function', function: { name: names.get(tool.name)!, description: stable ? `[${tool.name}] ${tool.description}` : tool.description, parameters: tool.inputSchema } })) }
}
export function providerMessages(input: readonly AgentMessage[], names: Map<string, string>, stable = false) {
  return input.map(message => {
    if (message.role === 'tool') return { role: 'tool', tool_call_id: message.callId, content: message.content }
    if (message.role !== 'assistant') return message
    return { role: 'assistant', content: message.content || null, ...message.providerReasoning, ...(message.toolCalls.length ? { tool_calls: message.toolCalls.map(call => ({
      id: call.id, type: 'function', function: { name: names.get(call.name) ?? (stable ? stableName(call.name) : call.name), arguments: JSON.stringify(call.arguments) }
    })) } : {}) }
  })
}
export function parseAgentResponse(value: unknown, names: Map<string, string>): AgentResponse {
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
  const reasoning = new ReasoningAccumulator(); reasoning.read(message)
  if (!toolCalls.length && !content.trim()) protocol()
  const usage = root.usage && typeof root.usage === 'object' ? root.usage as Record<string, unknown> : null
  return { content, toolCalls, ...(Object.keys(reasoning.state).length ? { providerReasoning: reasoning.state } : {}), ...(usage && Number.isSafeInteger(usage.prompt_tokens) && Number.isSafeInteger(usage.completion_tokens)
    && Number(usage.prompt_tokens) >= 0 && Number(usage.completion_tokens) >= 0 ? { usage: { inputTokens: Number(usage.prompt_tokens), outputTokens: Number(usage.completion_tokens) } } : {}) }
}
