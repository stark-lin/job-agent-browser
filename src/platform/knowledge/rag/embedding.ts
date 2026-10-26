import type { AISettings } from '../../../shared/ai'
import type { KnowledgePreferences } from '../../../shared/knowledge-settings'
import { openAIURL } from '../../ai/transport'
export interface EmbeddingProvider {
  identity(): string | null
  cancel?(): void
  embed(texts: string[], signal: AbortSignal): Promise<number[][]>
}
export function createKnowledgeEmbeddings(
  settings: () => AISettings,
  preferences: () => KnowledgePreferences,
  key: (id: string) => string | null
): EmbeddingProvider {
  const config = () => {
    const p = preferences(),
      provider = settings().providers.find((v) => v.id === p.providerId)
    return p.semanticEnabled && p.modelId && provider ? { p, provider } : null
  }
  const active = new Set<AbortController>()
  return {
    cancel() {
      for (const controller of active) controller.abort()
    },
    identity() {
      const c = config()
      return c ? JSON.stringify([c.provider.id, c.provider.baseURL, c.p.modelId]) : null
    },
    async embed(texts, signal) {
      const c = config()
      if (!c) throw new Error('SEMANTIC_UNAVAILABLE')
      const token = c.provider.requiresKey ? key(c.provider.id) : null
      if (c.provider.requiresKey && !token) throw new Error('SEMANTIC_UNAVAILABLE')
      const controller = new AbortController()
      active.add(controller)
      try {
        const response = await fetch(openAIURL(c.provider.baseURL, 'embeddings'), {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(30000)]),
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ model: c.p.modelId, input: texts, encoding_format: 'float' })
        })
        if (!response.ok || Number(response.headers.get('content-length')) > 8 * 1024 * 1024) {
          await response.body?.cancel()
          throw new Error('EMBEDDING_FAILED')
        }
        const reader = response.body?.getReader()
        if (!reader) throw new Error('EMBEDDING_FAILED')
        let bytes = 0,
          text = ''
        const decoder = new TextDecoder()
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            bytes += value.length
            if (bytes > 8 * 1024 * 1024) throw new Error('EMBEDDING_FAILED')
            text += decoder.decode(value, { stream: true })
          }
        } finally {
          await reader.cancel()
        }
        const body = JSON.parse(text) as { data?: { index: number; embedding: number[] }[] }
        if (!Array.isArray(body.data) || body.data.length !== texts.length) throw new Error('EMBEDDING_FAILED')
        const vectors = [...body.data].sort((a, b) => a.index - b.index)
        if (
          vectors.some(
            (v, i) =>
              v.index !== i ||
              !Array.isArray(v.embedding) ||
              !v.embedding.length ||
              v.embedding.length > 16384 ||
              v.embedding.some((n) => !Number.isFinite(n) || Math.abs(n) > 3.402823e38) ||
              v.embedding.length !== vectors[0].embedding.length
          )
        )
          throw new Error('EMBEDDING_FAILED')
        return vectors.map((v) => v.embedding)
      } finally {
        active.delete(controller)
      }
    }
  }
}
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length) return 0
  let dot = 0,
    x = 0,
    y = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    x += a[i] * a[i]
    y += b[i] * b[i]
  }
  return x && y ? dot / Math.sqrt(x * y) : 0
}
