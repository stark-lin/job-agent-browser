import { fail } from '../../domain/common/errors'
import { abortable } from '../../shared/agent'
import { AI_DEFAULTS, validModelId, type AISettings, type ModelOverrides } from '../../shared/ai'
import { apiKey, authMode, baseURL, providerId, timeoutSeconds } from '../storage/ai-preferences'
import { object } from '../storage/validation'
import type { Fetch } from './compatible'
import { authenticatedKey, checkResponse, openAIURL, requestTimeout } from './transport'

export async function modelMetadata(endpoint: string, key: string | null, signal: AbortSignal, transport: Fetch): Promise<Map<string, ModelOverrides>> {
  const response = await checkResponse(await transport(openAIURL(endpoint, 'models'), {
    method: 'GET', redirect: 'error', signal,
    headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }
  }))
  if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel(); return fail('AI_PROTOCOL_ERROR')
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0, payload: unknown
  try {
    for (;;) {
      signal.throwIfAborted()
      const part = await abortable(reader.read(), signal)
      if (part.done) break
      length += part.value.length
      if (length > 1000000) fail('AI_PROTOCOL_ERROR')
      chunks.push(part.value)
    }
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { return fail('AI_PROTOCOL_ERROR') }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data) || payload.data.length > 10000) return fail('AI_PROTOCOL_ERROR')
  if (!payload.data.length) return fail('AI_PROTOCOL_ERROR')
  const models = new Map<string, ModelOverrides>()
  for (const entry of payload.data) {
    if (!entry || typeof entry !== 'object' || !validModelId(entry.id)) return fail('AI_PROTOCOL_ERROR')
    const contextWindow = metadataLimit(entry.context_window ?? entry.context_length ?? entry.max_context_length)
    const maxOutputTokens = metadataLimit(entry.max_output_tokens ?? entry.max_completion_tokens)
    if (!models.has(entry.id)) models.set(entry.id, { contextWindow, maxOutputTokens })
  }
  return models
}

export function metadataLimit(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/** Metadata only: no generation, settings writes or provider payload persistence. */
export function createModelDiscovery(deps: { settings(): AISettings; key(id: string): string | null; transport?: Fetch; timeoutMs?: number }) {
  const requests = new Map<AbortController, { owner: number; done: Promise<string[]> }>()
  let disposed = false
  return {
    list(owner: number, input: unknown): Promise<string[]> {
      const args = object(input, ['baseURL', 'providerId', 'apiKey', 'authMode', 'clearKey', 'modelsSeconds'])
      const endpoint = baseURL(args.baseURL)
      const id = args.providerId === undefined ? undefined : providerId(args.providerId)
      const mode = authMode(args.authMode)
      if (args.clearKey !== undefined && typeof args.clearKey !== 'boolean' || args.clearKey && args.apiKey !== undefined) fail('INVALID_INPUT')
      const providedKey = args.apiKey === undefined ? undefined : apiKey(args.apiKey)
      const seconds = args.modelsSeconds === undefined ? undefined : timeoutSeconds(args.modelsSeconds)
      if (disposed || requests.size >= 16 || [...requests.values()].some(request => request.owner === owner)) fail('AI_PROVIDER_FAILED')
      const settings = deps.settings()
      const saved = settings.providers.find(provider => provider.id === id && provider.baseURL === endpoint)
      const key = authenticatedKey(mode, () => providedKey ?? (saved && !args.clearKey ? deps.key(saved.id) : null))
      const controller = new AbortController()
      const timeout = requestTimeout(controller.signal, deps.timeoutMs ?? (seconds ?? settings.timeoutOverrides?.modelsSeconds ?? AI_DEFAULTS.modelsTimeoutMs / 1000) * 1000)
      const done = abortable(modelMetadata(endpoint, key, timeout.signal, deps.transport ?? fetch), timeout.signal).then(models => {
        timeout.signal.throwIfAborted()
        return [...models.keys()].sort()
      }).catch(error => {
        if (controller.signal.aborted) fail('AI_CANCELLED')
        if (timeout.timedOut()) fail('AI_TIMEOUT')
        throw error
      }).finally(() => { timeout.dispose(); requests.delete(controller) })
      requests.set(controller, { owner, done })
      return done
    },
    disposeOwner(owner: number): void {
      for (const [controller, request] of requests) if (request.owner === owner) controller.abort()
    },
    async dispose(): Promise<void> {
      disposed = true
      for (const controller of requests.keys()) controller.abort()
      await Promise.allSettled([...requests.values()].map(request => request.done))
    }
  }
}
