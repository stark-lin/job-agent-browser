import { fail } from '../../domain/common/errors'
import { abortable } from '../../shared/agent'
import { AI_TIMEOUT, type AISettings } from '../../shared/ai'
import { apiKey, baseURL, providerId } from '../storage/ai-preferences'
import { object } from '../storage/validation'
import type { Fetch } from './compatible'
import { checkResponse, openAIURL, requestTimeout } from './transport'

export async function fetchModelMetadata(url: string | URL, key: string | null, signal: AbortSignal, transport: Fetch): Promise<unknown> {
  const response = await checkResponse(await transport(url, {
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
  return payload
}

async function discoverModels(endpoint: string, key: string | null, signal: AbortSignal, transport: Fetch): Promise<string[]> {
  const payload = await fetchModelMetadata(openAIURL(endpoint, 'models'), key, signal, transport)
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data) || !payload.data.length || payload.data.length > 10000) return fail('AI_PROTOCOL_ERROR')
  const models = payload.data.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 200 || /[\s\x00-\x1f]/.test(entry.id)) return fail('AI_PROTOCOL_ERROR')
    return entry.id
  })
  return [...new Set(models)].sort()
}

/** Metadata only: no generation, settings writes or provider payload persistence. */
export function createModelDiscovery(deps: { settings(): AISettings; key(id: string): string | null; transport?: Fetch; timeoutMs?: number }) {
  const requests = new Map<AbortController, { owner: number; done: Promise<string[]> }>()
  let disposed = false
  return {
    list(owner: number, input: unknown): Promise<string[]> {
      const args = object(input, ['baseURL', 'apiKey', 'providerId'])
      const endpoint = baseURL(args.baseURL), id = args.providerId === undefined ? undefined : providerId(args.providerId)
      const entered = args.apiKey === undefined ? '' : apiKey(args.apiKey)
      if (disposed || requests.size >= 16 || [...requests.values()].some(request => request.owner === owner)) fail('AI_PROVIDER_FAILED')
      const saved = !entered && id ? deps.settings().providers.find(provider => provider.id === id) : undefined
      const key = entered || (saved && new URL(saved.baseURL).origin === new URL(endpoint).origin ? deps.key(saved.id) : null)
      const controller = new AbortController(), timeout = requestTimeout(controller.signal, deps.timeoutMs ?? AI_TIMEOUT.models)
      const done = abortable(discoverModels(endpoint, key, timeout.signal, deps.transport ?? fetch), timeout.signal).then(models => {
        timeout.signal.throwIfAborted(); return models
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
