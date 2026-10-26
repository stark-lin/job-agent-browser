import { randomUUID } from 'node:crypto'
import { embeddingIdentity, validVectors, type EmbeddingRequest } from './embedding-protocol'
import type { EmbeddingProvider, EmbeddingPurpose } from './embedding'

// Electron owns the transport; the scheduler has no Electron, storage or MCP dependency.
export interface EmbeddingProcess {
  postMessage(value: EmbeddingRequest): void
  kill(): boolean
  on(event: 'message', callback: (value: unknown) => void): unknown
  on(event: 'exit', callback: (code: number) => void): unknown
}
interface Request {
  id: string; texts: string[]; purpose: EmbeddingPurpose; signal: AbortSignal
  resolve(vectors: number[][]): void; reject(error: Error): void; cleanup(): void
}
export class LocalEmbeddingProvider implements EmbeddingProvider {
  private child?: EmbeddingProcess
  private queue: Request[] = []
  private active?: Request
  private disposed = false
  constructor(private readonly options: {
    enabled(): boolean; available(): boolean; modelsDirectory: string
    fork(): EmbeddingProcess; timeoutMs?: number
  }) {}
  error() { return this.options.enabled() && !this.options.available() ? 'SEMANTIC_UNAVAILABLE' : null }
  identity() { return !this.disposed && this.options.enabled() && this.options.available() ? embeddingIdentity : null }
  embed(texts: string[], purpose: EmbeddingPurpose, signal: AbortSignal): Promise<number[][]> {
    if (!this.identity()) return Promise.reject(new Error('SEMANTIC_UNAVAILABLE'))
    if (signal.aborted) return Promise.reject(new Error('EMBEDDING_CANCELLED'))
    if (!['query', 'document'].includes(purpose) || !texts.length || texts.length > 16 ||
      texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 20000))
      return Promise.reject(new Error('EMBEDDING_INVALID_INPUT'))
    if (this.queue.length >= 32) return Promise.reject(new Error('EMBEDDING_BUSY'))
    return new Promise((resolve, reject) => {
      const request: Request = { id: randomUUID(), texts: [...texts], purpose, signal, resolve, reject, cleanup: () => {} }
      const abort = () => {
        const index = this.queue.indexOf(request)
        if (index >= 0) this.queue.splice(index, 1)
        if (this.active === request) { this.active = undefined; this.stopChild() }
        request.cleanup()
        reject(new Error(signal.aborted ? 'EMBEDDING_CANCELLED' : 'EMBEDDING_TIMEOUT'))
        this.pump()
      }
      const timer = setTimeout(abort, this.options.timeoutMs ?? 120000)
      request.cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
      signal.addEventListener('abort', abort, { once: true })
      if (purpose === 'query') {
        const index = this.queue.findIndex(r => r.purpose === 'document')
        this.queue.splice(index < 0 ? this.queue.length : index, 0, request)
      } else this.queue.push(request)
      this.pump()
    })
  }
  private stopChild() { const child = this.child; this.child = undefined; child?.kill() }
  private finish(error?: Error, vectors?: number[][]) {
    const request = this.active
    this.active = undefined
    if (request) {
      request.cleanup()
      if (error) request.reject(error)
      else request.resolve(vectors!)
    }
    this.pump()
  }
  private pump() {
    if (this.active || this.disposed || !this.queue.length) return
    if (!this.identity()) { this.cancel(); return }
    const request = this.queue.shift()!
    this.active = request
    try {
      if (!this.child) {
        const child = this.options.fork()
        this.child = child
        child.on('exit', () => {
          if (this.child !== child) return
          this.child = undefined
          this.finish(new Error('EMBEDDING_PROCESS_EXITED'))
        })
        child.on('message', (value: unknown) => {
          if (this.child !== child || !this.active) return
          const response = value as { id?: unknown; ok?: unknown; vectors?: unknown } | null
          if (!response || response.id !== this.active.id || response.ok !== true || !validVectors(response.vectors, this.active.texts.length)) {
            this.stopChild()
            this.finish(new Error('EMBEDDING_FAILED'))
          } else this.finish(undefined, response.vectors)
        })
      }
      this.child.postMessage({ id: request.id, texts: request.texts, purpose: request.purpose, modelsDirectory: this.options.modelsDirectory })
    } catch { this.stopChild(); this.finish(new Error('EMBEDDING_FAILED')) }
  }
  cancel() {
    const pending = [...(this.active ? [this.active] : []), ...this.queue]
    this.active = undefined
    this.queue = []
    this.stopChild()
    for (const request of pending) { request.cleanup(); request.reject(new Error('EMBEDDING_CANCELLED')) }
  }
  async dispose() { this.disposed = true; this.cancel() }
}
