import { existsSync } from 'node:fs'
import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import manifest from '../../../resources/embedding-model.json'
import { prepare } from './core.cjs'
import { ModelStore } from './store'
import type { ModelStatus, ModelState } from '../../shared/models'
export interface ModelManagerAPI {
  status(): ModelStatus
  install(source: 'download' | 'seed'): Promise<void>
  cancel(): Promise<void>
  verify(): Promise<ModelStatus>
  remove(): Promise<void>
  onProgress(listener: () => void): () => void
}
interface SeedPreferences { autoImportSeed: boolean; seedInitializedRevisions: string[] }
export class LocalModelManager implements ModelManagerAPI {
  readonly store: ModelStore
  readonly ready: Promise<void>
  private value: ModelStatus
  private listeners = new Set<() => void>()
  private controller?: AbortController
  private work?: Promise<unknown>
  private closed = false
  private readonly model: typeof manifest
  constructor(private options: { root: string; seed?: string; stop(): void | Promise<void>; activated(): void; fetcher?: typeof fetch; model?: typeof manifest }) {
    this.model = options.model ?? manifest
    this.store = new ModelStore(options.root, this.model.id, this.model.revision)
    this.value = { state: 'missing', id: this.model.id, revision: this.model.revision, dimensions: this.model.dimensions,
      directory: this.store.directory, completed: 0, total: this.model.files.reduce((n, f) => n + f.size, 0),
      error: null, seedAvailable: Boolean(options.seed && existsSync(options.seed)) }
    this.ready = this.initialize().catch(() => { if (this.value.state !== 'error') this.state('error', 'MODEL_OPERATION_FAILED') })
  }
  status() { return { ...this.value } }
  available() { return this.value.state === 'ready' && this.model.files.every(f => existsSync(join(this.store.directory, f.path))) }
  onProgress(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit() { for (const listener of this.listeners) listener() }
  private state(state: ModelState, error: string | null = null) { this.value.state = state; this.value.error = error; this.emit() }
  private async preferences(): Promise<SeedPreferences> {
    try {
      const value = JSON.parse(await readFile(join(this.options.root, 'seed-preferences.json'), 'utf8')) as SeedPreferences
      if (typeof value.autoImportSeed !== 'boolean' || !Array.isArray(value.seedInitializedRevisions) || value.seedInitializedRevisions.some(r => typeof r !== 'string')) throw new Error('MODEL_PREFERENCES_INVALID')
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { autoImportSeed: true, seedInitializedRevisions: [] }
      throw error
    }
  }
  private async remember(removed = false) {
    const prefs = await this.preferences()
    if (!prefs.seedInitializedRevisions.includes(this.model.revision)) prefs.seedInitializedRevisions.push(this.model.revision)
    if (removed) prefs.autoImportSeed = false
    const temporary = join(this.options.root, `seed-${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(prefs), { flag: 'wx' })
    await rename(temporary, join(this.options.root, 'seed-preferences.json'))
  }
  private async initialize() {
    await this.verify()
    if (this.closed || this.value.state !== 'missing' || !this.value.seedAvailable) return
    const prefs = await this.preferences()
    if (prefs.autoImportSeed && !prefs.seedInitializedRevisions.includes(this.model.revision)) await this.install('seed', true)
  }
  private start<T>(action: (signal: AbortSignal) => Promise<T>, operation: ModelState = 'verifying'): Promise<T> {
    if (this.work || this.closed) return Promise.reject(new Error('MODEL_BUSY'))
    this.state(operation)
    const mutation = operation === 'installing' || operation === 'removing'
    const controller = new AbortController()
    this.controller = controller
    const task = (async () => {
      await this.options.stop()
      const unlock = await this.store.lock(() => controller.abort(new Error('MODEL_LOCK_LOST')))
      try { await this.store.checkPaths(); if (mutation) await this.store.assertNoReaders(); return await action(controller.signal) }
      finally { await unlock() }
    })().then(result => { if (this.value.state === 'ready') this.options.activated(); return result }).catch(error => {
      const code = controller.signal.aborted ? 'MODEL_CANCELLED' : ((error as NodeJS.ErrnoException).code === 'ELOCKED' || (error as Error).message === 'MODEL_BUSY') ? 'MODEL_BUSY' : 'MODEL_OPERATION_FAILED'
      this.state('error', code)
      throw new Error(code)
    }).finally(() => { this.controller = undefined; this.work = undefined })
    this.work = task
    return task
  }
  verify() {
    return this.start(async signal => {
      this.state('verifying')
      if (!existsSync(this.store.directory)) { this.state('missing'); return this.status() }
      try {
        await prepare({ directory: this.store.directory, model: this.model, verify: true, signal })
        signal.throwIfAborted()
        this.state('ready')
      } catch (error) {
        if (signal.aborted) throw error
        this.state('corrupted', 'MODEL_CHECKSUM_FAILED')
      }
      return this.status()
    })
  }
  install(source: 'download' | 'seed', automatic = false) {
    if (!['download', 'seed'].includes(source)) return Promise.reject(new Error('MODEL_INVALID_SOURCE'))
    return this.start(async signal => {
      if (automatic) {
        const prefs = await this.preferences()
        if (!prefs.autoImportSeed || prefs.seedInitializedRevisions.includes(this.model.revision) || existsSync(this.store.directory)) {
          if (existsSync(this.store.directory)) {
            await prepare({ directory: this.store.directory, model: this.model, verify: true, signal })
            this.state('ready')
          } else this.state('missing')
          return
        }
      }
      this.value.completed = 0
      this.state('installing')
      if (source === 'seed' && !this.value.seedAvailable) throw new Error('MODEL_SEED_MISSING')
      // The fixed revision staging directory preserves fully verified files across retry/cancel.
      await rm(join(this.store.staging, '.installed.json'), { force: true })
      await prepare({ directory: this.store.staging, model: this.model, signal, fetcher: this.options.fetcher,
        seed: source === 'seed' ? this.options.seed : undefined,
        onProgress: (completed) => { this.value.completed = completed; this.emit() } })
      this.state('verifying')
      await prepare({ directory: this.store.staging, model: this.model, verify: true, signal })
      signal.throwIfAborted()
      await this.store.commit({ revision: this.model.revision, installedAt: new Date().toISOString(), source })
      await this.remember()
      this.state('ready')
    }, 'installing')
  }
  async acquireLease(compromised: () => void) {
    if (!this.available()) throw new Error('SEMANTIC_UNAVAILABLE')
    const release = await this.store.acquireLease(compromised)
    if (!this.available()) { await release(); throw new Error('SEMANTIC_UNAVAILABLE') }
    return release
  }
  async cancel() { this.controller?.abort(); await this.work?.catch(() => {}) }
  remove() {
    return this.start(async () => {
      this.state('removing')
      // Persist the user's choice before deleting any files, including on Full releases.
      await this.remember(true)
      await rm(this.store.directory, { recursive: true, force: true })
      await rm(this.store.staging, { recursive: true, force: true })
      this.value.completed = 0
      this.state('missing')
    }, 'removing')
  }
  async close() { this.closed = true; await this.cancel(); await this.ready; this.listeners.clear() }
}
