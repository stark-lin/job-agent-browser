import { fail } from '../../domain/common/errors'
import { defaultAITimeouts, type AISettings } from '../../shared/ai'
import { providerId } from '../storage/ai-preferences'
import { object } from '../storage/validation'
import type { Fetch } from './compatible'
import { checkResponse, openAIURL, providerConfig, requestTimeout } from './transport'

async function fetchModels(config: ReturnType<typeof providerConfig>, signal: AbortSignal, transport: Fetch): Promise<string[]> {
  const response = await checkResponse(await transport(openAIURL(config.provider.baseURL, 'models'), {
    method: 'GET', redirect: 'error', signal,
    headers: { Accept: 'application/json', ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}) }
  }))
  if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel(); return fail('AI_PROTOCOL_ERROR')
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0, payload: unknown
  try {
    for (;;) {
      signal.throwIfAborted()
      const part = await reader.read()
      if (part.done) break
      length += part.value.length
      if (length > 1000000) fail('AI_PROTOCOL_ERROR')
      chunks.push(part.value)
    }
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { return fail('AI_PROTOCOL_ERROR') }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data) || payload.data.length > 10000) return fail('AI_PROTOCOL_ERROR')
  const models = payload.data.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 200 || /[\s\x00-\x1f]/.test(entry.id)) return fail('AI_PROTOCOL_ERROR')
    return entry.id
  })
  return [...new Set(models)].sort()
}

/** Metadata only: no generation, settings writes or provider payloads in audit logs. */
export function createModelDiscovery(deps: { settings(): AISettings; key(id: string): string | null; transport?: Fetch; timeoutMs?: number }) {
  const requests = new Map<AbortController, { owner: number; done: Promise<string[]> }>()
  let disposed = false
  return {
    list(owner: number, input: unknown): Promise<string[]> {
      const id = providerId(object(input, ['providerId']).providerId)
      if (disposed || requests.size >= 16 || [...requests.values()].some(request => request.owner === owner)) fail('AI_PROVIDER_FAILED')
      const settings = deps.settings(), config = providerConfig(settings, deps.key, id)
      const controller = new AbortController(), timeout = requestTimeout(controller.signal, deps.timeoutMs ?? (settings.timeouts ?? defaultAITimeouts).modelsSeconds * 1000)
      const done = fetchModels(config, timeout.signal, deps.transport ?? fetch).then(models => {
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
