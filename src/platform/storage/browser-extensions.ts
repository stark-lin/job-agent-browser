import { lstatSync, readFileSync } from 'node:fs'
import { mkdir, lstat, readdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'
import type { ExtensionInstallResult, ExtensionManifestInfo, ExtensionSummary } from '../../shared/browser-extensions'
import { writeJSON } from './files'

export const extensionUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const electronExtensionId = /^[a-p]{32}$/
const digest = /^[0-9a-f]{64}$/
// Electron registers the Chromium PDF viewer as a component extension.
export const reservedExtensionIds = new Set(['mhjfbmdgcfjbbpaeojofohoefgiehjai'])

export interface InstalledExtension extends ExtensionManifestInfo {
  id: string
  source: ExtensionSummary['source']
  enabled: boolean
  fingerprint: string
  identity: string
  runtimeId: string | null
  installedAt: string
  pendingRemoval: boolean
}

type Receipt = {
  pathDigest: string
  result: Extract<ExtensionInstallResult, { status: 'INSTALLED_DISABLED' | 'ALREADY_INSTALLED' }>
}

interface ExtensionIndex {
  version: 1
  extensions: InstalledExtension[]
  receipts: Record<string, Receipt>
}

export function extensionSummary(record: InstalledExtension) {
  const { id, name, version, source, enabled, pendingRemoval } = record
  return { id, name, version, source, enabled, ...(pendingRemoval ? { pendingRemoval: true as const } : {}) }
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const match = (value: unknown, pattern: RegExp) => typeof value === 'string' && pattern.test(value)
const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string')

function installed(value: unknown): value is InstalledExtension {
  return object(value) && match(value.id, extensionUUID) && typeof value.name === 'string' && typeof value.version === 'string'
    && strings(value.permissions) && strings(value.sites) && (value.optionsPath === null || typeof value.optionsPath === 'string')
    && (value.source === 'manual' || value.source === 'mcp') && typeof value.enabled === 'boolean' && typeof value.pendingRemoval === 'boolean'
    && (!value.pendingRemoval || !value.enabled) && match(value.fingerprint, digest) && match(value.identity, electronExtensionId)
    && !reservedExtensionIds.has(String(value.identity)) && (value.runtimeId === null || value.runtimeId === value.identity)
    && typeof value.installedAt === 'string' && Number.isFinite(Date.parse(value.installedAt))
}

function receipt(value: unknown): value is Receipt {
  if (!object(value) || !match(value.pathDigest, digest) || !object(value.result)) return false
  const { status, extensionId, name, version, enabled, requiresUserAction, nextAction } = value.result
  return match(extensionId, extensionUUID) && typeof name === 'string' && typeof version === 'string' && typeof enabled === 'boolean'
    && (status === 'ALREADY_INSTALLED' || (status === 'INSTALLED_DISABLED' && enabled === false && requiresUserAction === true && nextAction === 'ENABLE_IN_SETTINGS'))
}

export async function managedDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  if (!(await lstat(path)).isDirectory()) throw new Error('INVALID_EXTENSION_STORAGE')
  return realpath(path)
}

export class BrowserExtensionStore {
  readonly root: string
  readonly indexPath: string

  constructor(userData: string) {
    this.root = join(userData, 'extensions')
    this.indexPath = join(this.root, 'index.json')
  }

  read(): ExtensionIndex {
    let value: unknown
    try {
      const stat = lstatSync(this.indexPath)
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('INVALID_EXTENSION_INDEX')
      value = JSON.parse(readFileSync(this.indexPath, 'utf8')) as unknown
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, extensions: [], receipts: {} }
      throw error
    }
    if (!object(value) || value.version !== 1 || !Array.isArray(value.extensions) || !value.extensions.every(installed)
      || !object(value.receipts) || !Object.entries(value.receipts).every(([key, entry]) => match(key, extensionUUID) && receipt(entry))
    ) {
      throw new Error('INVALID_EXTENSION_INDEX')
    }
    const extensions = value.extensions
    for (const key of ['id', 'fingerprint', 'identity'] as const) {
      if (new Set(extensions.map(row => row[key])).size !== extensions.length) throw new Error('INVALID_EXTENSION_INDEX')
    }
    return { version: 1, extensions, receipts: value.receipts as Record<string, Receipt> }
  }

  async locked<T>(operation: (index: ExtensionIndex, commit: () => void) => Promise<T> | T): Promise<T> {
    const root = await managedDirectory(this.root)
    let compromised: Error | undefined
    const release = await lockfile.lock(root, {
      lockfilePath: join(root, 'index.lock'), stale: 15000, retries: { retries: 12, minTimeout: 25, maxTimeout: 1000 },
      onCompromised: error => { compromised = error }
    })
    try {
      const index = this.read()
      return await operation(index, () => {
        if (compromised) throw compromised
        writeJSON(this.indexPath, index)
      })
    } finally {
      // A release error must not turn a committed import into a reported failure.
      await release().catch(() => {})
    }
  }

  async directories() {
    const root = await managedDirectory(this.root)
    return { packages: await managedDirectory(join(root, 'packages')), staging: await managedDirectory(join(root, 'staging')) }
  }

  async packagePath(id: string): Promise<string> {
    if (!extensionUUID.test(id)) throw new Error('INVALID_EXTENSION_ID')
    return join((await this.directories()).packages, id)
  }

  async recover(): Promise<void> {
    await this.locked(async index => {
      const { packages, staging } = await this.directories()
      const referenced = new Set(index.extensions.map(extension => extension.id))
      for (const name of await readdir(staging)) {
        if (extensionUUID.test(name)) await rm(join(staging, name), { recursive: true, force: true })
      }
      for (const name of await readdir(packages)) {
        if (extensionUUID.test(name) && !referenced.has(name)) await rm(join(packages, name), { recursive: true, force: true })
      }
    })
  }
}
