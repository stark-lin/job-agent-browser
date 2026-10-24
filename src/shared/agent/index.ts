import type { JsonSchema } from '../tools/tool.types'

export interface AgentToolDescriptor { name: string; description: string; inputSchema: JsonSchema; outputSchema?: JsonSchema }
/** A protocol client contract. Business results are returned as structured JSON. */
export interface AgentTools {
  list(): Promise<readonly AgentToolDescriptor[]>
  call(name: string, args: unknown, signal: AbortSignal): Promise<unknown>
}

export interface AgentToolCall { id: string; name: string; arguments: unknown }
export type AgentMessage = { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: AgentToolCall[] }
  | { role: 'tool'; callId: string; content: string }
export interface AgentResponse { content: string; toolCalls: AgentToolCall[] }
export interface AgentModelInput { messages: readonly AgentMessage[]; tools: readonly AgentToolDescriptor[]; signal: AbortSignal }
export interface AgentModel { complete(input: AgentModelInput): Promise<AgentResponse> }
export type AgentModelEvent = { type: 'content.delta' | 'reasoning.delta'; text: string }
  | { type: 'tool_call.ready'; call: AgentToolCall }
  | { type: 'completed'; response: AgentResponse }
export interface StreamingAgentModel extends AgentModel { stream(input: AgentModelInput): AsyncIterable<AgentModelEvent> }
export type AgentErrorCode = 'AGENT_CANCELLED' | 'AGENT_TIMEOUT' | 'AGENT_PROTOCOL_ERROR' | 'AGENT_STEP_LIMIT'
  | 'AI_NOT_CONFIGURED' | 'AI_AUTH_FAILED' | 'AI_RATE_LIMITED' | 'AI_PROVIDER_FAILED' | 'AI_CONNECT_FAILED' | 'AUDIT_UNAVAILABLE'
export class AgentError extends Error {
  constructor(readonly code: AgentErrorCode) { super(code) }
}
/** Bound work even when an injected model or transport ignores cancellation. */
export async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort!: () => void
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new AgentError('AGENT_CANCELLED'))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
  try { return await Promise.race([operation, cancelled]) }
  finally { signal.removeEventListener('abort', onAbort) }
}
