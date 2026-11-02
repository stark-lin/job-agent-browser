import { relative, join } from 'node:path'
import { readFile, unlink } from 'node:fs/promises'
import type { SpaceId } from '../../shared/smart-note'
import type { KnowledgeMethods, SpaceMethod } from '../electron/knowledge-contract'
import type { Result } from '../../shared/ipc'
import { KnowledgeError } from '../../domain/knowledge'
import { KnowledgeService, type KnowledgeDependencies } from './service'
import { createWorkspaceStorage } from './workspace-storage'
import { atomicWrite } from './paths'
import { WorkspaceEmbeddingQueue } from './workspace-embedding'
const spaceMethods = new Set<SpaceMethod>(['tree', 'read', 'write', 'mkdir', 'move', 'delete', 'search', 'retrieve', 'history', 'restore', 'rebuild'])
export function normalizedRemote(remote: string) {
  const url = new URL(remote)
  return `${url.origin.toLowerCase()}${url.pathname.replace(/\.git$/, '').toLowerCase()}`
}
/** One owner for storage, Git, watcher, backup and the model queue. Child services are fixed-space views. */
export class SmartNoteWorkspace {
  readonly storage
  readonly spaces: Record<SpaceId, KnowledgeService>
  readonly ready: Promise<void>
  private consentRemote: string | null = null
  private currentRemote: string
  private remoteEpoch = 0
  private consentWork: Promise<unknown> = Promise.resolve()
  private embeddings?: WorkspaceEmbeddingQueue
  private watcher?: { close(): Promise<void> }
  private timer?: ReturnType<typeof setTimeout>
  private reconcile?: ReturnType<typeof setInterval>
  private stopped = false
  private closing?: Promise<void>
  private lifecycle = new AbortController()
  private listeners = new Set<() => void>()
  constructor(readonly directory: string, readonly deps: KnowledgeDependencies, readonly owner = true) {
    this.currentRemote = deps.preferences().remote
    this.storage = createWorkspaceStorage(directory, owner)
    const provider = deps.embeddings ? new WorkspaceEmbeddingQueue(deps.embeddings) : undefined
    this.embeddings = provider
    const service = (space: SpaceId) => new KnowledgeService(directory, {
      ...deps, watch: false, embeddings: provider, storage: this.storage, space,
      consent: remote => this.consentRemote === normalizedRemote(remote)
    })
    this.spaces = { knowledge: service('knowledge'), memory: service('memory') }
    this.ready = this.initialize()
    this.ready.catch(() => {})
  }
  get files() { return this.spaces.knowledge.files }
  get index() { return this.spaces.knowledge.index }
  get backup() { return this.spaces.knowledge.backup }
  private async initialize() {
    await Promise.all(Object.values(this.spaces).map(s => s.ready))
    if (this.owner) {
      await this.backup.recover()
      await this.backup.backup('Initial workspace backup')
      try {
        await this.consentWork
        const value = JSON.parse(await readFile(join(this.storage.runtime, 'consent.json'), 'utf8'))
        if (value.generation === 1 && value.remote === normalizedRemote(this.deps.preferences().remote)) this.consentRemote = value.remote
      } catch { /* Upgrades and new remotes require explicit consent. */ }
      if (this.deps.watch && !this.stopped) {
        const { watch } = await import('chokidar')
        this.watcher = watch(this.storage.root, { ignoreInitial: true, followSymlinks: false,
          ignored: path => relative(this.storage.root, path).split(/[\\/]/).some(p => p.startsWith('.')) || path.endsWith('.tmp')
        }).on('all', () => this.changed()).on('error', () => {
          for (const service of Object.values(this.spaces)) service.index.error = 'WATCH_FAILED'
          for (const listener of this.listeners) listener()
        })
        this.reconcile = setInterval(() => this.refreshEmbeddings(), 30000); this.reconcile.unref()
        this.refreshEmbeddings()
      }
    }
    for (const service of Object.values(this.spaces)) service.onChanged(() => { for (const cb of this.listeners) cb() })
  }
  /** Called by trusted preference composition, including saves through general Settings IPC. */
  remoteChanged(remote: string) {
    if (!this.owner || remote === this.currentRemote) return
    let same = false
    try { same = (remote ? normalizedRemote(remote) : '') === (this.currentRemote ? normalizedRemote(this.currentRemote) : '') } catch { /* Invalid candidates revoke consent too. */ }
    this.currentRemote = remote
    if (same) return
    this.consentRemote = null; this.remoteEpoch++
    this.consentWork = this.consentWork.catch(() => {}).then(() => unlink(join(this.storage.runtime, 'consent.json')).catch(error => { if (error.code !== 'ENOENT') throw error }))
    this.consentWork.catch(() => {})
  }
  onChanged(callback: () => void) { this.listeners.add(callback); return () => { this.listeners.delete(callback) } }
  refreshEmbeddings() { for (const service of Object.values(this.spaces)) service.refreshEmbeddings() }
  async queryVector(query: string) {
    await this.ready
    const identity = this.embeddings?.identity()
    if (!identity) return undefined
    try {
      const [values] = await this.embeddings!.embed([query], 'query', this.lifecycle.signal)
      return this.embeddings?.identity() === identity ? { identity, values } : undefined
    } catch { return undefined }
  }
  private changed() {
    if (this.stopped) return
    for (const s of Object.values(this.spaces)) s.changed()
    clearTimeout(this.timer)
    if (this.owner) this.timer = setTimeout(() => { void this.backup.backup().catch(() => {}) }, 30000)
  }
  async call<K extends keyof KnowledgeMethods>(method: K, input: KnowledgeMethods[K]['input'], signal?: AbortSignal): Promise<Result<KnowledgeMethods[K]['output']>> {
    try {
      await this.ready; signal?.throwIfAborted()
      if (this.stopped) throw new KnowledgeError('KNOWLEDGE_UNAVAILABLE')
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
      this.remoteChanged(this.deps.preferences().remote)
      const { space, ...args } = input as Record<string, unknown>
      if (space !== undefined && (!spaceMethods.has(method as SpaceMethod) || (typeof space !== 'string' || !['knowledge', 'memory'].includes(space)))) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
      const selected: SpaceId = space === 'memory' ? 'memory' : 'knowledge'
      if (method === 'syncConsent' || method === 'approveSync') {
        if (!this.owner) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
        const remote = this.deps.preferences().remote
        if (method === 'syncConsent') {
          if (Object.keys(args).length) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
          return { ok: true, value: { remote, required: Boolean(remote && this.consentRemote !== normalizedRemote(remote)) } as KnowledgeMethods[K]['output'] }
        }
        if (Object.keys(args).length !== 1 || args.remote !== remote || !remote) throw new KnowledgeError('KNOWLEDGE_CONFLICT')
        const epoch = this.remoteEpoch
        const work = this.consentWork.catch(() => {}).then(async () => {
          if (epoch !== this.remoteEpoch || remote !== this.deps.preferences().remote) throw new KnowledgeError('KNOWLEDGE_CONFLICT')
          await atomicWrite(join(this.storage.runtime, 'consent.json'), JSON.stringify({ generation: 1, remote: normalizedRemote(remote) }))
          if (epoch !== this.remoteEpoch || remote !== this.deps.preferences().remote) throw new KnowledgeError('KNOWLEDGE_CONFLICT')
          this.consentRemote = normalizedRemote(remote)
        })
        this.consentWork = work
        await work
        return { ok: true, value: null as KnowledgeMethods[K]['output'] }
      }
      if (method === 'configure' && typeof args.remote === 'string') this.remoteChanged(args.remote)
      if (method === 'configure') this.deps.embeddings?.cancel?.()
      const result = await this.spaces[selected].call(method, args as KnowledgeMethods[K]['input'], signal)
      if (method === 'configure') { this.remoteChanged(this.deps.preferences().remote); if (result.ok) this.refreshEmbeddings() }
      if (result.ok && ['write', 'mkdir', 'move', 'delete', 'restore', 'sync'].includes(method)) this.changed()
      return result
    } catch (e) { return { ok: false, error: e instanceof KnowledgeError ? e.code : 'KNOWLEDGE_UNAVAILABLE' } }
  }
  close() { return this.closing ??= this.shutdown() }
  private async shutdown() {
    this.stopped = true; this.lifecycle.abort(); clearTimeout(this.timer); clearInterval(this.reconcile)
    await this.ready.catch(() => {}); await this.watcher?.close()
    for (const s of Object.values(this.spaces)) s.index.abort.abort()
    if (this.owner) this.deps.embeddings?.cancel?.()
    await Promise.all(Object.values(this.spaces).map(s => s.close()))
    await this.embeddings?.close()
    await this.consentWork.catch(() => {})
    if (this.owner) {
      await this.backup.backup('App exit backup').catch(() => {})
      await this.deps.embeddings?.dispose?.()
    }
    this.listeners.clear()
  }
}
