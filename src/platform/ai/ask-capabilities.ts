import { AgentError } from '../../shared/agent'
import type { AIChoice, AISettings, ModelCapabilities } from '../../shared/ai'

/** Runtime metadata overrides manual/theoretical values. Never identify a local model by name alone. */
export async function resolveAskCapabilities(settings: AISettings, choice: AIChoice, key: string | null, signal: AbortSignal, transport: typeof fetch = fetch): Promise<ModelCapabilities> {
  const provider = settings.providers.find(p => p.id === choice.providerId)
  if (!provider) throw new AgentError('AI_NOT_CONFIGURED')
  const configured = provider.capabilities?.[choice.modelId]
  const url = new URL(provider.baseURL), local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (local) {
    try {
      const endpoint = new URL('/api/v1/models', url)
      const reply = await transport(endpoint, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]), headers: key ? { Authorization: `Bearer ${key}` } : {} })
      if (reply.ok && reply.headers.get('content-type')?.includes('application/json')) {
        const reader = reply.body?.getReader()
        if (!reader) throw new Error()
        const chunks: Uint8Array[] = []; let size = 0
        try {
          for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1000000) throw new Error(); chunks.push(part.value) }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
        const payload = JSON.parse(raw) as { models?: { key: string; loaded_instances: { id: string; config: { context_length: number } }[] }[] }
        const model = payload.models?.find(m => m.key === choice.modelId || m.loaded_instances?.some(i => i.id === choice.modelId))
        if (model) {
          const instances = model.loaded_instances.filter(i => i.id === choice.modelId || model.key === choice.modelId)
          const windows = instances.map(i => i.config.context_length).filter(n => Number.isSafeInteger(n) && n > 0)
          if (windows.length) return { contextWindow: Math.min(...windows), maxOutputTokens: Math.min(configured?.maxOutputTokens ?? 8192, ...windows), source: 'runtime', verified: true }
          // A known but unloaded local model has no verified effective deployment window.
          throw new AgentError('ASK_CONTEXT_UNKNOWN')
        }
      } else await reply.body?.cancel()
    } catch (error) { if (signal.aborted || error instanceof AgentError) throw error }
    if (configured?.verified && ['runtime', 'manual'].includes(configured.source)) return configured
    throw new AgentError('ASK_CONTEXT_UNKNOWN')
  }
  if (configured?.verified && ['runtime', 'provider'].includes(configured.source)) return configured
  const { getBuiltinModels, getBuiltinProviders } = await import('@earendil-works/pi-ai/providers/all')
  for (const id of getBuiltinProviders()) {
    const model = getBuiltinModels(id).find(m => m.id === choice.modelId && new URL(m.baseUrl).origin === url.origin)
    if (model) return { contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens, source: 'catalog', verified: true }
  }
  if (configured?.verified) return configured
  throw new AgentError('ASK_CONTEXT_UNKNOWN')
}
