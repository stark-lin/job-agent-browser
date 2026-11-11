import { AgentError, abortable } from '../../shared/agent'
import { FALLBACK_CONTEXT_WINDOW, FALLBACK_MAX_OUTPUT_TOKENS, type AIChoice, type AISettings, type ModelCapabilities } from '../../shared/ai'
import { fetchModelMetadata } from './models'
import { openAIURL, requestTimeout } from './transport'

function limit(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000_000 ? value : undefined
}

/** Resolve effective deployment limits for one run. Metadata failure is optional, cancellation is not. */
export async function resolveAskCapabilities(settings: AISettings, choice: AIChoice, key: string | null, signal: AbortSignal, transport: typeof fetch = fetch): Promise<ModelCapabilities> {
  const provider = settings.providers.find(p => p.id === choice.providerId)
  if (!provider?.models.includes(choice.modelId)) throw new AgentError('AI_NOT_CONFIGURED')
  const modelId = choice.modelId, manual = provider.overrides?.[modelId]
  const url = new URL(provider.baseURL), endpoint = openAIURL(provider.baseURL, 'models')
  const timeout = requestTimeout(signal, 3_000)
  const resolve = (contextWindow: number, maxOutputTokens: number | undefined, source: ModelCapabilities['source']): ModelCapabilities => ({
    contextWindow, maxOutputTokens: Math.min(contextWindow, maxOutputTokens ?? manual?.maxOutputTokens ?? FALLBACK_MAX_OUTPUT_TOKENS), source
  })
  async function metadata<T>(address: URL | string): Promise<T | undefined> {
    try {
      timeout.signal.throwIfAborted()
      return await abortable(fetchModelMetadata(address, key, timeout.signal, transport), timeout.signal) as T
    } catch {
      signal.throwIfAborted()
      return undefined
    }
  }
  try {
    let localWindow: number | undefined
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      const reply = await metadata<{ models?: { key: string; max_context_length?: number; loaded_instances?: { id: string; config?: { context_length?: number } }[] }[] }>(new URL('/api/v1/models', url))
      const models = Array.isArray(reply?.models) ? reply.models : []
      localWindow = limit(models.find(model => model?.key === modelId)?.max_context_length)
      const windows = models.flatMap(model =>
        (Array.isArray(model?.loaded_instances) ? model.loaded_instances : [])
          .filter(instance => instance && (instance.id === modelId || model.key === modelId))
          .map(instance => limit(instance.config?.context_length)).filter(value => value !== undefined))
      if (windows.length) return resolve(windows.reduce((min, value) => Math.min(min, value)), undefined, 'runtime')
    }
    const reply = await metadata<{ data?: { id: string; context_window?: number; context_length?: number; max_output_tokens?: number }[] }>(endpoint)
    const entry = Array.isArray(reply?.data) ? reply.data.find(item => item?.id === modelId) : undefined
    const providerWindow = limit(entry?.context_window) ?? limit(entry?.context_length) ?? localWindow, providerOutput = limit(entry?.max_output_tokens)
    if (providerWindow) return resolve(providerWindow, providerOutput, 'provider')
    const { getBuiltinModels, getBuiltinProviders } = await import('@earendil-works/pi-ai/providers/all')
    signal.throwIfAborted()
    for (const id of getBuiltinProviders()) {
      const model = getBuiltinModels(id).find(m => m.id === modelId && URL.canParse(m.baseUrl) && openAIURL(m.baseUrl, 'models') === endpoint)
      if (model) return resolve(model.contextWindow, providerOutput ?? model.maxTokens, 'catalog')
    }
    return resolve(manual?.contextWindow ?? FALLBACK_CONTEXT_WINDOW, providerOutput ?? manual?.maxOutputTokens,
      manual?.contextWindow || manual?.maxOutputTokens ? 'manual' : 'fallback')
  } finally { timeout.dispose() }
}
