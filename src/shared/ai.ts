import type { Result } from './ipc'

export interface AIProvider {
  id: string; name: string; baseURL: string; requiresKey: boolean
  models: string[]; defaultModel: string
}
export interface AIChoice { providerId: string; modelId: string }
export interface AISettings { providers: AIProvider[]; default: AIChoice | null }
export const defaultAISettings: AISettings = {
  providers: [{ id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', requiresKey: true, models: [], defaultModel: '' }], default: null
}
export type AIError = 'INVALID_INPUT' | 'FORBIDDEN' | 'AUDIT_UNAVAILABLE' | 'ENCRYPTION_UNAVAILABLE' | 'STORAGE_UNAVAILABLE'
  | 'AI_NOT_CONFIGURED' | 'AI_AUTH_FAILED' | 'AI_RATE_LIMITED' | 'AI_PROVIDER_FAILED' | 'AI_PROTOCOL_ERROR'
  | 'AI_CONNECT_FAILED' | 'AI_TIMEOUT' | 'AI_CANCELLED'
export interface AIMessage { role: 'user' | 'assistant'; content: string }
export interface AIInput { choice: AIChoice; messages: AIMessage[] }
export type AIEvent = { requestId: string } & (
  { type: 'started' } | { type: 'delta'; text: string } | { type: 'completed' } | { type: 'cancelled' } | { type: 'failed'; error: AIError }
)
export interface AIAPI {
  start(input: AIInput): Promise<Result<{ requestId: string }, AIError>>
  cancel(input: { requestId: string }): Promise<Result<null, AIError>>
  onEvent(callback: (event: AIEvent) => void): () => void
}
export const AI_START = 'ai:start', AI_CANCEL = 'ai:cancel', AI_EVENT = 'ai:event'
