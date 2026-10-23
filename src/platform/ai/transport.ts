import { fail } from '../../domain/common/errors'
import type { AIChoice, AISettings } from '../../shared/ai'
import type { ChatRequest, Fetch } from './compatible'

export function requestConfig(settings: AISettings, key: (id: string) => string | null, choice: AIChoice | null) {
  const provider = settings.providers.find(provider => provider.id === choice?.providerId)
  if (!choice || !provider || !provider.models.includes(choice.modelId)) fail('AI_NOT_CONFIGURED')
  const secret = provider.requiresKey ? key(provider.id) : null
  if (provider.requiresKey && !secret) fail('AI_NOT_CONFIGURED')
  return { provider: structuredClone(provider), model: choice.modelId, key: secret }
}
export async function postChat(request: Omit<ChatRequest, 'messages'>, body: object, signal: AbortSignal, stream: boolean, transport: Fetch = fetch) {
  const response = await transport(`${request.provider.baseURL}/chat/completions`, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json', ...(request.key ? { Authorization: `Bearer ${request.key}` } : {}) },
    body: JSON.stringify({ model: request.model, ...body, stream })
  })
  if (!response.ok) {
    await response.body?.cancel()
    fail(response.status === 401 || response.status === 403 ? 'AI_AUTH_FAILED' : response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_FAILED')
  }
  return response
}
export function requestTimeout(parent: AbortSignal, ms = 120000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: AbortSignal.any([parent, controller.signal]), timedOut: () => controller.signal.aborted, dispose: () => clearTimeout(timer) }
}
