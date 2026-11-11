import type { Result } from './ipc'
import type { Preferences } from './settings'

export const AI_DEFAULTS = {
  contextWindow: 65_536,
  maxOutputTokens: 8_192,
  requestTimeoutMs: 300_000,
  modelsTimeoutMs: 15_000,
  pageTimeoutMs: 20_000,
} as const

export interface ModelOverrides { contextWindow?: number; maxOutputTokens?: number }
export interface ModelCapabilities {
  contextWindow: number; maxOutputTokens: number
  source: 'catalog' | 'provider' | 'runtime' | 'manual' | 'fallback'
}
export type AuthenticationOverride = 'none' | 'bearer'
export interface AIProvider {
  id: string; name: string; baseURL: string; models: string[]
  authMode?: AuthenticationOverride
  overrides?: Record<string, ModelOverrides>
}
export interface AIChoice { providerId: string; modelId: string }
export interface AITimeoutOverrides { requestSeconds?: number; modelsSeconds?: number; pageSeconds?: number }
export interface AISettings { providers: AIProvider[]; default: AIChoice | null; timeoutOverrides?: AITimeoutOverrides }
export const defaultAISettings: AISettings = {
  providers: [{ id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', models: [] }], default: null
}

export function normalizeAIEndpoint(input: string): string | undefined {
  if (input.length > 2048 || /[?#]/.test(input)) return
  try {
    const url = new URL(input.trim())
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password) return
    return url.href.replace(/\/+$/, '')
  } catch { return undefined }
}

export function validModelId(input: unknown): input is string {
  return typeof input === 'string' && input.length > 0 && input.length <= 200 && !/[\s\x00-\x1f]/.test(input)
}

export interface DiscoveryInput {
  baseURL: string
  apiKey?: string
  providerId?: string
  authMode?: AuthenticationOverride
  clearKey?: boolean
  modelsSeconds?: number
}

export type AIConnectionChange =
  | { provider: AIProvider; modelId: string; previousEndpoint?: string; apiKey?: string; clearKey?: boolean; timeoutOverrides?: AITimeoutOverrides }
  | { removeProviderId: string; previousEndpoint: string }

export type AIError = 'INVALID_INPUT' | 'FORBIDDEN' | 'ENCRYPTION_UNAVAILABLE' | 'STORAGE_UNAVAILABLE'
  | 'AI_NOT_CONFIGURED' | 'AI_AUTH_FAILED' | 'AI_RATE_LIMITED' | 'AI_PROVIDER_FAILED' | 'AI_PROTOCOL_ERROR'
  | 'AI_CONNECT_FAILED' | 'AI_TIMEOUT' | 'AI_CANCELLED'
export interface AIMessage { role: 'user' | 'assistant'; content: string }
export interface AIInput { choice: AIChoice; messages: AIMessage[] }
export type AIEvent = { requestId: string } & (
  { type: 'started' } | { type: 'delta'; text: string } | { type: 'completed' } | { type: 'cancelled' } | { type: 'failed'; error: AIError }
)
export interface AIAPI {
  listModels(input: DiscoveryInput): Promise<Result<string[], AIError>>
  saveConnection(input: AIConnectionChange): Promise<Result<Preferences, AIError>>
  start(input: AIInput): Promise<Result<{ requestId: string }, AIError>>
  cancel(input: { requestId: string }): Promise<Result<null, AIError>>
  onEvent(callback: (event: AIEvent) => void): () => void
}

export const AI_START = 'ai:start', AI_CANCEL = 'ai:cancel', AI_EVENT = 'ai:event', AI_MODELS = 'ai:models', AI_SAVE_CONNECTION = 'ai:save-connection'
