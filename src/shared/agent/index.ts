import type { JsonSchema } from '../tools/tool.types'
import type { ProviderReasoning, ReasoningInfo } from './reasoning'
import type { ActivationDiagnostic, PreparedRequest, RequestContext, RequestDiagnostic } from './requests'
export type { ProviderReasoning, ReasoningInfo } from './reasoning'
export type { ActivationDiagnostic, PreparedRequest, PreparedTool, RequestContext, RequestDiagnostic } from './requests'

export interface AgentToolDescriptor { name: string; description: string; inputSchema: JsonSchema; outputSchema?: JsonSchema; risk?: 'READ' | 'COMPUTE' | 'WRITE' | 'EXTERNAL_ACTION' }
/** A protocol client contract. Business results are returned as structured JSON. */
export interface AgentTools {
  list(): Promise<readonly AgentToolDescriptor[]>
  call(name: string, args: unknown, signal: AbortSignal): Promise<unknown>
}

export interface AgentToolCall { id: string; name: string; arguments: unknown }
export type AgentMessage = { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: AgentToolCall[]; providerReasoning?: ProviderReasoning }
  | { role: 'tool'; callId: string; content: string }
export interface AgentUsage { inputTokens: number; outputTokens: number }
export interface AgentResponse { content: string; toolCalls: AgentToolCall[]; usage?: AgentUsage; providerReasoning?: ProviderReasoning }
export interface AgentModelInput { messages: readonly AgentMessage[]; tools: readonly AgentToolDescriptor[]; signal: AbortSignal; maxOutputTokens?: number; stableToolNames?: boolean; validateRequest?(payload: object): void
  requestContext?: RequestContext; onRequestPrepared?(request: PreparedRequest): void }
export interface AgentModel { complete(input: AgentModelInput): Promise<AgentResponse> }
export type AgentModelEvent = { type: 'content.delta'; text: string }
  | { type: 'reasoning.delta'; text: string; reasoning?: ReasoningInfo }
  | { type: 'tool_call.ready'; call: AgentToolCall }
  | { type: 'completed'; response: AgentResponse }
export interface StreamingAgentModel extends AgentModel { stream(input: AgentModelInput): AsyncIterable<AgentModelEvent> }
export type AgentRuntimeEvent = { type: 'segment.started'; id: string; kind: 'reasoning' | 'assistant_message'; reasoning?: ReasoningInfo }
  | { type: 'segment.delta'; id: string; text: string }
  | { type: 'segment.completed'; id: string }
  | { type: 'tool.started'; id: string; call: AgentToolCall }
  | { type: 'tool.completed'; id: string; name: string; result: unknown; durationMs: number }
  | { type: 'tool.failed'; id: string; name: string; error: string; durationMs: number; uncertain: boolean }
  | { type: 'model.completed'; response: AgentResponse }
  | { type: 'model.request.prepared'; request: RequestDiagnostic }
  | { type: 'model.request.activation'; activation: ActivationDiagnostic }
export type AgentErrorCode = 'AGENT_CANCELLED' | 'AGENT_TIMEOUT' | 'AGENT_PROTOCOL_ERROR' | 'AGENT_STEP_LIMIT'
  | 'AI_NOT_CONFIGURED' | 'AI_AUTH_FAILED' | 'AI_RATE_LIMITED' | 'AI_PROVIDER_FAILED' | 'AI_CONNECT_FAILED' | 'AUDIT_UNAVAILABLE'
  | 'ASK_CONTEXT_UNKNOWN' | 'ASK_CONTEXT_TOO_SMALL' | 'ASK_CONTEXT_OVERFLOW'
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
