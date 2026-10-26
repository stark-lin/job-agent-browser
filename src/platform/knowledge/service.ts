import { relative } from 'node:path'
import { KnowledgeFiles } from './filesystem'
import { KnowledgeBackup } from './git/backup'
import { KnowledgeIndex, brokerVector } from './rag'
import type { EmbeddingProvider } from './rag/embedding'
import { KnowledgeError } from '../../domain/knowledge'
import type { KnowledgePreferences } from '../../shared/knowledge-settings'
import type { KnowledgeMethods } from '../electron/knowledge-contract'
import type { Result } from '../../shared/ipc'
export interface KnowledgeDependencies {
  preferences(): KnowledgePreferences
  configure?(value: unknown): KnowledgePreferences
  token?(): string | null
  tokenStatus?(): boolean
  saveToken?(value: string | null): void
  embeddings?: EmbeddingProvider
  watch?: boolean
}
export class KnowledgeService {
  readonly files: KnowledgeFiles
  readonly backup: KnowledgeBackup
  readonly index: KnowledgeIndex
  readonly ready: Promise<void>
  private watcher?: { close(): Promise<void> }
  private listeners = new Set<() => void>()
  private refreshTimer?: ReturnType<typeof setTimeout>
  private backupTimer?: ReturnType<typeof setTimeout>
  private reconcileTimer?: ReturnType<typeof setInterval>
  private embeddingWork: Promise<void> = Promise.resolve()
  private stopped = false
  constructor(
    readonly directory: string,
    readonly deps: KnowledgeDependencies
  ) {
    this.files = new KnowledgeFiles(directory)
    this.backup = new KnowledgeBackup(this.files, deps.preferences, deps.token)
    this.index = new KnowledgeIndex(this.files, deps.embeddings)
    this.ready = this.initialize()
    this.ready.catch(() => {})
  }
  private async initialize() {
    await this.files.initialize()
    await this.backup.recover()
    await this.backup.backup('Initial backup').catch(() => {})
    if (this.deps.watch) {
      const { watch } = await import('chokidar')
      if (this.stopped) return
      this.watcher = watch(this.files.root, {
        ignoreInitial: true,
        followSymlinks: false,
        ignored: (path) =>
          relative(this.files.root, path)
            .split(/[\\/]/)
            .some((p) => p.startsWith('.')) || path.endsWith('.tmp')
      })
        .on('all', () => this.changed())
        .on('error', () => {
          this.index.error = 'WATCH_FAILED'
        })
      this.reconcileTimer = setInterval(() => this.scheduleIndex(), 30000)
      this.reconcileTimer.unref()
      this.scheduleIndex()
    }
  }
  onChanged(callback: () => void) {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }
  private changed() {
    if (this.stopped) return
    clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      for (const listener of this.listeners) listener()
      this.scheduleIndex()
    }, 150)
    clearTimeout(this.backupTimer)
    this.backupTimer = setTimeout(() => {
      void this.backup.backup().catch(() => {})
    }, 30000)
  }
  private scheduleIndex() {
    if (this.stopped) return
    void this.index
      .reconcile()
      .then(() => {
        this.embeddingWork = this.embeddingWork.then(() => this.index.indexEmbeddings()).catch(() => {})
      })
      .catch(() => {})
  }
  async search(query: string, limit = 10) {
    await this.ready
    await this.index.reconcile()
    const vector = this.deps.embeddings
      ? await this.index.queryVector(query)
      : await brokerVector(this.directory, query)
    return this.index.search(query, limit, vector)
  }
  async retrieve(query: string, maxContext = 4000) {
    await this.ready
    await this.index.reconcile()
    const vector = this.deps.embeddings
      ? await this.index.queryVector(query)
      : await brokerVector(this.directory, query)
    return this.index.retrieve(query, maxContext, vector)
  }
  async call<K extends keyof KnowledgeMethods>(
    method: K,
    input: KnowledgeMethods[K]['input'],
    signal?: AbortSignal
  ): Promise<Result<KnowledgeMethods[K]['output']>> {
    try {
      await this.ready
      signal?.throwIfAborted()
      const v = input as unknown as Record<string, unknown>
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
      const keys: Record<keyof KnowledgeMethods, string[]> = {
        tree: [],
        read: ['path'],
        write: ['path', 'content', 'expectedRevision'],
        mkdir: ['path'],
        move: ['source', 'target', 'expectedRevision'],
        delete: ['path', 'expectedRevision', 'recursive'],
        search: ['query', 'limit'],
        retrieve: ['query', 'maxContext'],
        history: ['offset', 'limit'],
        status: [],
        backup: [],
        restore: ['commit', 'expectedRevision'],
        sync: [],
        rebuild: [],
        view: ['mode', 'explorerWidth'],
        configure: ['mode', 'explorerWidth', 'remote', 'branch', 'semanticEnabled'],
        configuration: [],
        token: ['token']
      }
      if (!keys[method] || Object.keys(v).some((k) => !keys[method].includes(k)))
        throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
      const path = (key: string) => {
        if (typeof v[key] !== 'string') throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
        return v[key] as string
      }
      const number = (key: string, defaultValue: number, max: number) => {
        const n = v[key] ?? defaultValue
        if (!Number.isSafeInteger(n) || Number(n) < (key === 'offset' ? 0 : 1) || Number(n) > max)
          throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
        return Number(n)
      }
      let value: unknown
      switch (method) {
        case 'tree':
          value = await this.files.tree()
          break
        case 'read':
          value = await this.files.read(path('path'))
          break
        case 'write':
          value = await this.files.write(path('path'), path('content'), v.expectedRevision as string | null, signal)
          break
        case 'mkdir':
          value = await this.files.mkdir(path('path'), signal)
          break
        case 'move':
          value = await this.files.move(path('source'), path('target'), path('expectedRevision'), signal)
          break
        case 'delete':
          if (typeof v.recursive !== 'boolean') throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
          await this.backup.backup('Before delete')
          value = await this.files.delete(path('path'), path('expectedRevision'), v.recursive, signal)
          break
        case 'search':
        case 'retrieve': {
          const query = path('query').trim()
          if (!query || query.length > 2048) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
          value =
            method === 'search'
              ? await this.search(query, number('limit', 10, 50))
              : await this.retrieve(query, number('maxContext', 4000, 16000))
          break
        }
        case 'history':
          value = await this.backup.history(number('offset', 0, 10000), number('limit', 25, 100))
          break
        case 'status':
          value = await this.backup.status()
          break
        case 'backup':
          value = await this.backup.backup('Manual backup')
          break
        case 'restore':
          value = await this.backup.restore(path('commit'), path('expectedRevision'))
          break
        case 'sync':
          value = await this.backup.sync()
          break
        case 'rebuild':
          this.deps.embeddings?.cancel?.()
          await this.embeddingWork
          value = await this.index.rebuild()
          this.scheduleIndex()
          break
        case 'view':
          if (!this.deps.configure) throw new KnowledgeError('KNOWLEDGE_UNAVAILABLE')
          value = this.deps.configure({ ...this.deps.preferences(), ...v })
          break
        case 'configure':
          if (!this.deps.configure) throw new KnowledgeError('KNOWLEDGE_UNAVAILABLE')
          this.index.abort.signal.throwIfAborted()
          value = this.deps.configure(v)
          this.deps.embeddings?.cancel?.()
          if (this.index.error === 'SEMANTIC_UNAVAILABLE') this.index.error = null
          this.scheduleIndex()
          break
        case 'configuration':
          value = {
            preferences: this.deps.preferences(),
            tokenConfigured: this.deps.tokenStatus?.() ?? false,
            indexError: this.index.error ?? this.deps.embeddings?.error?.() ?? null
          }
          break
        case 'token':
          if (!this.deps.saveToken || (v.token !== null && typeof v.token !== 'string'))
            throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
          this.deps.saveToken(v.token as string | null)
          value = { configured: this.deps.tokenStatus?.() ?? false }
          break
      }
      if (['write', 'mkdir', 'move', 'delete', 'restore', 'sync'].includes(method)) {
        this.changed()
        await this.index.reconcile().catch(() => {})
      }
      return { ok: true, value: value as KnowledgeMethods[K]['output'] }
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof KnowledgeError
            ? e.code
            : (e as { code?: string })?.code === 'ENCRYPTION_UNAVAILABLE'
              ? 'ENCRYPTION_UNAVAILABLE'
              : 'KNOWLEDGE_UNAVAILABLE'
      }
    }
  }
  async close() {
    this.stopped = true
    this.backup.abort.abort()
    this.deps.embeddings?.cancel?.()
    clearTimeout(this.refreshTimer)
    clearTimeout(this.backupTimer)
    clearInterval(this.reconcileTimer)
    await this.ready.catch(() => {})
    await this.watcher?.close()
    this.index.abort.abort()
    await this.embeddingWork
    await this.deps.embeddings?.dispose?.()
    await this.backup.backup('App exit backup').catch(() => {})
    await this.index.close()
    this.listeners.clear()
  }
}
