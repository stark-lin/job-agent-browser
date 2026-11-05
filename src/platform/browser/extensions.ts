import type { FSWatcher } from 'chokidar' with { 'resolution-mode': 'import' }
import { lstatSync, realpathSync } from 'node:fs'
import { lstat, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { session, type Extension, type Session } from 'electron'
import type { ExtensionView } from '../../shared/browser-extensions'
import { extensionSummary, reservedExtensionIds, type InstalledExtension } from '../storage/browser-extensions'
import { BrowserExtensionInstaller, ExtensionImportError, resourcePath } from './extension-installer'
import { SESSION_PARTITION } from './sessionManager'

const origin = (id: string) => `chrome-extension://${id}`

async function existingDirectory(path: string) {
  try {
    if (!(await lstat(path)).isDirectory() || await realpath(path) !== path) throw new Error('UNSAFE_EXTENSION_STORAGE')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export interface ExtensionOptionsTarget {
  id: string
  url: string
  allows(url: string): boolean
}

export class BrowserExtensionRuntime {
  private browserSession?: Session
  private watcher?: FSWatcher
  private readonly states = new Map<string, 'LOADING' | 'FAILED'>()
  private readonly loaded = new Map<string, InstalledExtension>()
  private readonly managedPaths = new Map<string, string>()
  private readonly cleanupFailures = new Set<string>()
  private pending = Promise.resolve()
  private unavailable = false

  constructor(readonly installer: BrowserExtensionInstaller, private readonly changed: () => void,
    private readonly closeOptions: (id: string) => void) {}

  async start(sessionData: string): Promise<void> {
    let pending: InstalledExtension[] = []
    try {
      await this.installer.store.recover()
      pending = this.installer.store.read().extensions.filter(record => record.pendingRemoval)
    } catch { this.unavailable = true }

    // Chromium keeps chrome.storage in separate per-ID stores, outside the origin storage API.
    // Do this before creating the persistent BrowserContext and opening those stores.
    for (const record of pending) {
      if (!record.runtimeId) continue
      try {
        const partitions = join(await realpath(sessionData), 'Partitions')
        if (!(await existingDirectory(partitions))) continue
        const profile = join(partitions, SESSION_PARTITION.slice('persist:'.length))
        if (!(await existingDirectory(profile))) continue
        for (const namespace of ['Local Extension Settings', 'Sync Extension Settings']) {
          const dir = join(profile, namespace)
          if (!(await existingDirectory(dir))) continue
          const target = join(dir, record.runtimeId)
          if (await existingDirectory(target)) await rm(target, { force: true, recursive: true })
        }
      } catch { this.cleanupFailures.add(record.id) }
    }
    this.browserSession = session.fromPartition(SESSION_PARTITION)
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.browserSession.setPermissionCheckHandler(() => false)
    this.browserSession.extensions.on('extension-loaded', this.onLoad)
    this.browserSession.extensions.on('extension-unloaded', this.onUnload)
    this.browserSession.extensions.on('extension-ready', this.onReady)
    if (this.unavailable) return

    for (const record of pending) {
      if (this.cleanupFailures.has(record.id)) continue
      try {
        if (record.runtimeId) {
          if (this.browserSession.extensions.getExtension(record.runtimeId)) throw new Error('EXTENSION_ID_OCCUPIED')
          await this.browserSession.clearStorageData({ origin: origin(record.runtimeId),
            storages: ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers', 'filesystem'] })
        }
        await this.installer.store.locked(async (index, commit) => {
          const entry = index.extensions.find(item => item.id === record.id && item.pendingRemoval)
          if (!entry) return
          await rm(await this.installer.store.packagePath(entry.id), { force: true, recursive: true })
          index.extensions = index.extensions.filter(item => item.id !== entry.id)
          commit()
        })
      } catch { this.cleanupFailures.add(record.id) }
    }

    try {
      const { extensions } = this.installer.store.read()
      for (const record of extensions) {
        if (record.enabled && !record.pendingRemoval) await this.load(record)
      }
    } catch { this.unavailable = true }
    const { watch } = await import('chokidar')
    const { root, indexPath } = this.installer.store
    this.watcher = watch(root, { depth: 0, ignoreInitial: true, ignored: path => path !== root && path !== indexPath })
    this.watcher.on('ready', this.changed).on('all', this.changed).on('error', this.changed)
  }

  list(): ExtensionView[] {
    if (this.unavailable) throw new ExtensionImportError('UNAVAILABLE')
    return this.installer.store.read().extensions.map(record => {
      const status = record.pendingRemoval ? 'PENDING_REMOVAL' : this.states.get(record.id)
        ?? (this.isRunning(record) ? 'RUNNING' : record.enabled ? 'FAILED' : 'DISABLED')
      return { ...extensionSummary(record), status, canOpenOptions: status === 'RUNNING' && !!record.optionsPath,
        permissions: record.permissions, sites: record.sites, cleanupFailed: this.cleanupFailures.has(record.id) }
    })
  }

  importDirectory(path: string, fingerprint: string): Promise<void> {
    return this.serial(async () => {
      const record = await this.installer.installManual(path, fingerprint)
      await this.load(record)
    })
  }

  setEnabled(id: string, enabled: boolean): Promise<void> {
    return this.serial(async () => {
      const record = await this.change(id, entry => { entry.enabled = enabled })
      if (enabled) {
        if (!this.isRunning(record)) await this.load(record)
      } else this.unload(record)
    })
  }

  remove(id: string): Promise<void> {
    return this.serial(async () => {
      const record = await this.change(id, entry => {
        entry.pendingRemoval = true
        entry.enabled = false
      })
      this.unload(record)
    })
  }

  openOptions(id: string, open: (target: ExtensionOptionsTarget) => Promise<void>): Promise<void> {
    return this.serial(async () => {
      const record = this.installer.store.read().extensions.find(item => item.id === id)
      if (!record?.optionsPath || !this.isRunning(record) || !record.runtimeId) throw new ExtensionImportError('UNAVAILABLE')
      const runtimeId = record.runtimeId
      const directory = await this.installer.store.packagePath(id)
      const allows = (value: string) => {
        try {
          const url = new URL(value)
          if (!this.isRunning(record) || url.protocol !== 'chrome-extension:' || url.host !== runtimeId || url.username || url.password) return false
          const path = resourcePath(url.pathname.slice(1).split('/').map(part => {
            const decoded = decodeURIComponent(part)
            if (decoded.includes('/')) throw new Error('INVALID_RESOURCE')
            return decoded
          }).join('/'))
          if (!path) return false
          const file = join(directory, path)
          const stat = lstatSync(file)
          return stat.isFile() && stat.nlink === 1 && realpathSync(file) === file
        } catch { return false }
      }
      const url = `${origin(runtimeId)}/${record.optionsPath.split('/').map(encodeURIComponent).join('/')}`
      if (!allows(url)) throw new ExtensionImportError('UNAVAILABLE')
      await open({ id, url, allows })
    })
  }

  async close() {
    await this.watcher?.close()
    await this.pending
    this.browserSession?.extensions.off('extension-loaded', this.onLoad)
    this.browserSession?.extensions.off('extension-unloaded', this.onUnload)
    this.browserSession?.extensions.off('extension-ready', this.onReady)
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(async () => {
      if (this.unavailable) throw new ExtensionImportError('UNAVAILABLE')
      return operation()
    }).finally(this.changed)
    this.pending = next.then(() => {}, () => {})
    return next
  }

  private change(id: string, update: (record: InstalledExtension) => void) {
    return this.installer.store.locked((index, commit) => {
      const record = index.extensions.find(item => item.id === id)
      if (!record || record.pendingRemoval) throw new ExtensionImportError('UNAVAILABLE')
      update(record)
      commit()
      return record
    })
  }

  private isRunning(record: InstalledExtension): boolean {
    return Boolean(record.runtimeId && this.loaded.get(record.runtimeId)?.id === record.id
      && this.browserSession?.extensions.getExtension(record.runtimeId))
  }

  private async load(record: InstalledExtension) {
    this.states.set(record.id, 'LOADING')
    this.changed()
    const extensions = this.browserSession!.extensions
    try {
      const path = await this.installer.verify(record)
      if (reservedExtensionIds.has(record.identity) || extensions.getExtension(record.identity)) throw new Error('EXTENSION_ID_OCCUPIED')
      record = await this.change(record.id, entry => { entry.runtimeId = entry.identity })
      this.managedPaths.set(record.identity, path)
      this.loaded.set(record.identity, record)
      const loaded = await extensions.loadExtension(path, { allowFileAccess: false })
      if (loaded.id !== record.runtimeId) {
        extensions.removeExtension(loaded.id)
        throw new Error('UNEXPECTED_EXTENSION_ID')
      }
      this.states.delete(record.id)
    } catch {
      this.loaded.delete(record.identity)
      this.states.set(record.id, 'FAILED')
    }
    this.changed()
  }

  private unload(record: InstalledExtension) {
    this.states.delete(record.id)
    this.closeOptions(record.id)
    if (!record.runtimeId || !this.loaded.delete(record.runtimeId)) return
    this.browserSession!.extensions.removeExtension(record.runtimeId)
  }

  private onLoad = (_event: Electron.Event, extension: Extension) => {
    if (this.loaded.has(extension.id) || this.managedPaths.get(extension.id) !== extension.path) return
    // An extension-triggered reload may finish after the user has disabled it.
    setImmediate(() => {
      const extensions = this.browserSession?.extensions
      if (!this.loaded.has(extension.id) && extensions?.getExtension(extension.id)?.path === extension.path) {
        extensions.removeExtension(extension.id)
      }
    })
  }

  private onUnload = (_event: Electron.Event, extension: Extension) => {
    const record = this.loaded.get(extension.id)
    if (record) this.closeOptions(record.id)
    this.changed()
  }

  private onReady = () => this.changed()
}
