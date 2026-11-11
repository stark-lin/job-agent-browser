import type { Result } from './ipc'

export const FALLBACK_CONTEXT_WINDOW = 65_536
export const FALLBACK_MAX_OUTPUT_TOKENS = 8_192
export const AI_TIMEOUT = { models: 15_000, page: 20_000, inference: 300_000 } as const

export interface ModelOverride { contextWindow?: number; maxOutputTokens?: number }
export interface ModelCapabilities {
  contextWindow: number; maxOutputTokens: number
  source: 'catalog' | 'provider' | 'runtime' | 'manual' | 'fallback'
}
export interface AIProvider {
  id: string; name: string; baseURL: string; models: string[]
  overrides?: Record<string, ModelOverride>
}
export interface AIChoice { providerId: string; modelId: string }
export interface AISettings { providers: AIProvider[]; default: AIChoice | null }
export interface AIConnection { baseURL: string; apiKey?: string; providerId?: string }
export interface AIConnectionSave { provider: AIProvider; modelId: string; apiKey?: string }
export const defaultAISettings: AISettings = {
  providers: [{ id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com', models: [] }], default: null
}
export type AIError = 'INVALID_INPUT' | 'FORBIDDEN' | 'ENCRYPTION_UNAVAILABLE' | 'STORAGE_UNAVAILABLE'
  | 'AI_NOT_CONFIGURED' | 'AI_AUTH_FAILED' | 'AI_RATE_LIMITED' | 'AI_PROVIDER_FAILED' | 'AI_PROTOCOL_ERROR'
  | 'AI_CONNECT_FAILED' | 'AI_TIMEOUT' | 'AI_CANCELLED'
export interface AIMessage { role: 'user' | 'assistant'; content: string }
export interface AIInput { choice: AIChoice; messages: AIMessage[] }
export type AIEvent = { requestId: string } & (
  { type: 'started' } | { type: 'delta'; text: string } | { type: 'completed' } | { type: 'cancelled' } | { type: 'failed'; error: AIError }
)
export interface AIAPI {
  listModels(input: AIConnection): Promise<Result<string[], AIError>>
  start(input: AIInput): Promise<Result<{ requestId: string }, AIError>>
  cancel(input: { requestId: string }): Promise<Result<null, AIError>>
  onEvent(callback: (event: AIEvent) => void): () => void
}

export const AI_START = 'ai:start', AI_CANCEL = 'ai:cancel', AI_EVENT = 'ai:event', AI_MODELS = 'ai:models'
