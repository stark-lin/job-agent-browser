import type { EmbeddingProvider, EmbeddingPurpose } from './rag/embedding'
interface Work { texts: string[]; purpose: EmbeddingPurpose; signal: AbortSignal; resolve(value: number[][]): void; reject(error: unknown): void; cleanup(): void }
/** Workspace queue: one model operation at a time, queries ahead of queued documents. */
export class WorkspaceEmbeddingQueue implements EmbeddingProvider {
  private pending: Work[] = []
  private active?: Promise<void>
  private stopped = false
  constructor(private provider: EmbeddingProvider) {}
  identity() { return this.stopped ? null : this.provider.identity() }
  error() { return this.provider.error?.() ?? null }
  embed(texts: string[], purpose: EmbeddingPurpose, signal: AbortSignal): Promise<number[][]> {
    if (this.stopped || signal.aborted) return Promise.reject(new Error('EMBEDDING_CANCELLED'))
    if (this.pending.length >= 32) return Promise.reject(new Error('EMBEDDING_BUSY'))
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = this.pending.indexOf(work)
        if (index >= 0) { this.pending.splice(index, 1); work.cleanup(); reject(new Error('EMBEDDING_CANCELLED')) }
      }
      const work: Work = { texts: [...texts], purpose, signal, resolve, reject, cleanup: () => signal.removeEventListener('abort', abort) }
      signal.addEventListener('abort', abort, { once: true })
      const index = purpose === 'query' ? this.pending.findIndex(value => value.purpose === 'document') : -1
      this.pending.splice(index < 0 ? this.pending.length : index, 0, work)
      this.pump()
    })
  }
  private pump() {
    if (this.active || this.stopped) return
    const work = this.pending.shift(); if (!work) return
    this.active = Promise.resolve().then(() => { work.signal.throwIfAborted(); return this.provider.embed(work.texts, work.purpose, work.signal) })
      .then(work.resolve, work.reject).finally(() => { work.cleanup(); this.active = undefined; this.pump() })
  }
  async close() {
    this.stopped = true
    for (const work of this.pending.splice(0)) { work.cleanup(); work.reject(new Error('EMBEDDING_CANCELLED')) }
    this.provider.cancel?.(); await this.active
  }
}
