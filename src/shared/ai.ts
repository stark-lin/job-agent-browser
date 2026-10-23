import type { Result } from './ipc'

export interface AIProvider {
  id: string; name: string; baseURL: string; requiresKey: boolean
  models: string[]; defaultModel: string; parallelModels?: string[]
}
export interface AIChoice { providerId: string; modelId: string }
export interface AITimeouts { requestSeconds: number; pageSeconds: number; modelsSeconds: number }
export const defaultAITimeouts: Readonly<AITimeouts> = { requestSeconds: 120, pageSeconds: 20, modelsSeconds: 15 }
export interface AISettings { providers: AIProvider[]; default: AIChoice | null; timeouts?: AITimeouts }
export const defaultAISettings: AISettings = {
  timeouts: { ...defaultAITimeouts },
  providers: [{ id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com', requiresKey: true, models: [], defaultModel: '' }], default: null
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
  listModels(input: { providerId: string }): Promise<Result<string[], AIError>>
  start(input: AIInput): Promise<Result<{ requestId: string }, AIError>>
  cancel(input: { requestId: string }): Promise<Result<null, AIError>>
  onEvent(callback: (event: AIEvent) => void): () => void
}
export function allowsParallelImport(settings: AISettings | null, choice: AIChoice | null): boolean {
  return Boolean(choice && settings?.providers.some(provider => provider.id === choice.providerId
    && provider.models.includes(choice.modelId) && provider.parallelModels?.includes(choice.modelId)))
}

export const AI_START = 'ai:start', AI_CANCEL = 'ai:cancel', AI_EVENT = 'ai:event', AI_MODELS = 'ai:models'
