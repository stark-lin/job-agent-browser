import type { ToolDescriptor } from '../tools/tool.types'

export interface AgentToolCall { id: string; name: string; arguments: unknown }
export type AgentMessage = { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: AgentToolCall[] }
  | { role: 'tool'; callId: string; content: string }
export interface AgentResponse { content: string; toolCalls: AgentToolCall[] }
export interface AgentModel {
  complete(input: { messages: readonly AgentMessage[]; tools: readonly ToolDescriptor[]; signal: AbortSignal }): Promise<AgentResponse>
}
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
