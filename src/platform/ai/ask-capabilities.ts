import { AgentError, abortable } from '../../shared/agent'
import { AI_DEFAULTS, type AIChoice, type AISettings, type ModelCapabilities, type ModelOverrides } from '../../shared/ai'
import { metadataLimit, modelMetadata } from './models'
import { authenticatedKey, openAIURL, requestTimeout } from './transport'

async function lmStudioContext(url: URL, modelId: string, key: string | null, signal: AbortSignal, transport: typeof fetch): Promise<number | undefined> {
  const reply = await transport(new URL('/api/v1/models', url), {
    redirect: 'error', signal, headers: key ? { Authorization: `Bearer ${key}` } : {}
  })
  if (!reply.ok || !reply.body || !reply.headers.get('content-type')?.includes('application/json')) {
    await reply.body?.cancel()
    return
  }
  const reader = reply.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const part = await abortable(reader.read(), signal)
      if (part.done) break
      size += part.value.length
      if (size > 1_000_000) return
      chunks.push(part.value)
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as {
    models?: { key: string; loaded_instances?: { id: string; config?: { context_length?: number } }[] }[]
  }
  const windows = payload.models?.flatMap(model => (model.loaded_instances ?? [])
    .filter(instance => instance.id === modelId || model.key === modelId)
    .map(instance => metadataLimit(instance.config?.context_length))
    .filter(value => value !== undefined)) ?? []
  return windows.length ? Math.min(...windows) : undefined
}

async function catalogLimits(endpoint: string, modelId: string): Promise<ModelOverrides | undefined> {
  const { getBuiltinModels, getBuiltinProviders } = await import('@earendil-works/pi-ai/providers/all')
  const target = openAIURL(endpoint, 'models')
  for (const id of getBuiltinProviders()) {
    const model = getBuiltinModels(id).find(model => model.id === modelId && openAIURL(model.baseUrl, 'models') === target)
    if (model) return { contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens }
  }
}

/** Resolve each limit independently, keeping deployment metadata out of Preferences. */
export async function resolveAskCapabilities(settings: AISettings, choice: AIChoice, readKey: () => string | null, signal: AbortSignal, transport: typeof fetch = fetch): Promise<ModelCapabilities> {
  const provider = settings.providers.find(p => p.id === choice.providerId)
  if (!provider) throw new AgentError('AI_NOT_CONFIGURED')
  const key = authenticatedKey(provider.authMode, readKey)
  const manual = Object.hasOwn(provider.overrides ?? {}, choice.modelId) ? provider.overrides?.[choice.modelId] : undefined
  const url = new URL(provider.baseURL)
  const metadataTimeout = (settings.timeoutOverrides?.modelsSeconds ?? AI_DEFAULTS.modelsTimeoutMs / 1000) * 1000
  async function detect<T>(read: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T | undefined> {
    signal.throwIfAborted()
    const timeout = requestTimeout(signal, ms)
    try { return await abortable(read(timeout.signal), timeout.signal) }
    catch { signal.throwIfAborted(); return undefined }
    finally { timeout.dispose() }
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const [runtime, reported] = await Promise.all([
    local ? detect(live => lmStudioContext(url, choice.modelId, key, live, transport), Math.min(3000, metadataTimeout)) : undefined,
    !manual?.contextWindow || !manual?.maxOutputTokens
      ? detect(async live => (await modelMetadata(provider.baseURL, key, live, transport)).get(choice.modelId), metadataTimeout)
      : undefined
  ])
  const catalog = (!(runtime ?? manual?.contextWindow ?? reported?.contextWindow) || !(manual?.maxOutputTokens ?? reported?.maxOutputTokens))
    ? await catalogLimits(provider.baseURL, choice.modelId) : undefined
  signal.throwIfAborted()
  const contextWindow = runtime === undefined
    ? manual?.contextWindow ?? reported?.contextWindow ?? catalog?.contextWindow ?? AI_DEFAULTS.contextWindow
    : Math.min(runtime, manual?.contextWindow ?? runtime)
  const maxOutputTokens = Math.min(contextWindow, manual?.maxOutputTokens ?? reported?.maxOutputTokens ?? catalog?.maxOutputTokens ?? AI_DEFAULTS.maxOutputTokens)
  const source = runtime !== undefined ? 'runtime' : manual?.contextWindow || manual?.maxOutputTokens ? 'manual'
    : reported?.contextWindow || reported?.maxOutputTokens ? 'provider' : catalog ? 'catalog' : 'fallback'
  return { contextWindow, maxOutputTokens, source }
}
