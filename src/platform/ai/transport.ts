import { fail } from '../../domain/common/errors'
import { AI_DEFAULTS, type AIChoice, type AIProvider, type AISettings } from '../../shared/ai'
import type { ChatRequest, Fetch } from './compatible'

export function authenticatedKey(mode: AIProvider['authMode'], read: () => string | null): string | null {
  if (mode === 'none') return null
  const secret = read()
  if (mode === 'bearer' && !secret) fail('AI_AUTH_FAILED')
  return secret
}

export function providerConfig(settings: AISettings, key: (id: string) => string | null, providerId: string) {
  const provider = settings.providers.find(provider => provider.id === providerId)
  if (!provider) fail('AI_NOT_CONFIGURED')
  return { provider: structuredClone(provider), key: authenticatedKey(provider.authMode, () => key(provider.id)) }
}
export function requestConfig(settings: AISettings, key: (id: string) => string | null, choice: AIChoice | null) {
  if (!choice) fail('AI_NOT_CONFIGURED')
  const config = providerConfig(settings, key, choice.providerId)
  if (!config.provider.models.includes(choice.modelId)) fail('AI_NOT_CONFIGURED')
  return { ...config, model: choice.modelId, timeoutMs: (settings.timeoutOverrides?.requestSeconds ?? AI_DEFAULTS.requestTimeoutMs / 1000) * 1000 }
}
/** Bare server endpoints use /v1; explicit API roots retain their path prefix. */
export function openAIURL(endpoint: string, resource: 'chat/completions' | 'models' | 'embeddings'): string {
  const url = new URL(endpoint.trim())
  const root = url.pathname.replace(/\/+$/, '') || '/v1'
  url.pathname = `${root}/${resource}`
  return url.href
}
export async function checkResponse(response: Response): Promise<Response> {
  if (!response.ok) {
    await response.body?.cancel()
    fail(response.status === 401 || response.status === 403 ? 'AI_AUTH_FAILED' : response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_FAILED')
  }
  return response
}
export async function postChat(request: Omit<ChatRequest, 'messages'>, body: object, signal: AbortSignal, stream: boolean, transport: Fetch = fetch) {
  signal.throwIfAborted()
  const response = await transport(openAIURL(request.provider.baseURL, 'chat/completions'), {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json', ...(request.key ? { Authorization: `Bearer ${request.key}` } : {}) },
    body: JSON.stringify({ model: request.model, ...body, stream })
  })
  return checkResponse(response)
}
export function outputTokenParameters(request: Omit<ChatRequest, 'messages'>, limit: number | undefined) {
  if (!limit) return {}
  return new URL(request.provider.baseURL).hostname === 'api.openai.com' ? { max_completion_tokens: limit } : { max_tokens: limit }
}
export function requestTimeout(parent: AbortSignal, ms: number = AI_DEFAULTS.requestTimeoutMs) {
  const controller = new AbortController()
  const expire = () => controller.abort()
  let timer = setTimeout(expire, ms)
  const signal = AbortSignal.any([parent, controller.signal])
  return {
    signal, timedOut: () => controller.signal.aborted,
    refresh() {
      if (signal.aborted) return
      clearTimeout(timer)
      timer = setTimeout(expire, ms)
    },
    dispose: () => clearTimeout(timer)
  }
}
