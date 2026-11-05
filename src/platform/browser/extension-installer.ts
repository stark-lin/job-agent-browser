import { createHash, randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, opendir, realpath, rename, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ExtensionError, ExtensionInstallResult, ExtensionManifestInfo } from '../../shared/browser-extensions'
import { BrowserExtensionStore, reservedExtensionIds, type InstalledExtension } from '../storage/browser-extensions'

const maxPackageBytes = 128 * 1024 * 1024
const maxManifestBytes = 1024 * 1024
const maxEntries = 10000
const maxDepth = 64
const text = new TextDecoder('utf-8', { fatal: true })
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const dictionary = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

export class ExtensionImportError extends Error {
  constructor(readonly code: ExtensionError) { super(code) }
}

const invalidPath = (): never => { throw new ExtensionImportError('INVALID_PATH') }
const invalidManifest = (): never => { throw new ExtensionImportError('INVALID_MANIFEST') }

function safeName(name: string): boolean {
  return Boolean(name && name !== '.' && name !== '..' && !/[<>:"/\\|?*\x00-\x1f]/.test(name)
    && !/[. ]$/.test(name) && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))
}

export function resourcePath(value: string): string | null {
  const path = value.replace(/^(?:\.\/)+/, '')
  return path.split('/').every(safeName) && !/[#%]/.test(path) ? path : null
}

function parseJSON(bytes: Buffer): unknown {
  try { return JSON.parse(text.decode(bytes)) as unknown } catch { return invalidManifest() }
}

function list(value: unknown): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) return invalidManifest()
  return value
}

function strings(value: unknown): string[] {
  return list(value).map(item => {
    if (typeof item !== 'string' || !item || item.length > 4096) return invalidManifest()
    return item
  })
}

function extensionId(input: Buffer | string) {
  return sha256(input).slice(0, 32).replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)))
}

function extensionIdentity(path: string, key?: string): string {
  if (key) {
    const base64 = key.trim().replace(/^-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----$/g, '').replace(/\s+/g, '')
    const bytes = Buffer.from(base64, 'base64')
    if (!bytes.length || bytes.toString('base64') !== base64) return invalidManifest()
    return extensionId(bytes)
  }
  const normalized = path.replace(/^[a-z]:/, drive => drive.toUpperCase())
  return extensionId(process.platform === 'win32' ? Buffer.from(normalized, 'utf16le') : path)
}

function manifestInfo(files: Map<string, Buffer | undefined>): { manifest: ExtensionManifestInfo; keyedIdentity?: string } {
  const bytes = files.get('manifest.json')
  if (!bytes) return invalidManifest()
  const data = dictionary(parseJSON(bytes))
  if (!data || data.manifest_version !== 3 || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 256
    || typeof data.version !== 'string' || !/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(data.version)) return invalidManifest()
  const version = data.version.split('.').map(Number)
  if (version.some(part => part > 65535) || version.every(part => part === 0)) return invalidManifest()
  if (data.key !== undefined && (typeof data.key !== 'string' || !data.key.trim())) return invalidManifest()
  const keyedIdentity = data.key === undefined ? undefined : extensionIdentity('', data.key)
  if (keyedIdentity && reservedExtensionIds.has(keyedIdentity)) return invalidManifest()

  function resource(value: unknown): string {
    const path = typeof value === 'string' && resourcePath(value)
    if (!path || !files.has(path)) return invalidManifest()
    return path
  }
  function icons(value: unknown) {
    if (value === undefined) return
    if (typeof value === 'string') { resource(value); return }
    const sizes = dictionary(value)
    if (!sizes) return invalidManifest()
    Object.values(sizes).forEach(resource)
  }
  let name = data.name
  if (data.default_locale !== undefined) {
    if (typeof data.default_locale !== 'string' || !/^[\w@-]+$/.test(data.default_locale)) return invalidManifest()
    const locale = files.get(`_locales/${data.default_locale}/messages.json`)
    if (!locale) return invalidManifest()
    const messages = dictionary(parseJSON(locale))
    if (!messages) return invalidManifest()
    const localized = /^__MSG_([\w@]+)__$/i.exec(name)
    if (localized) {
      const message = Object.entries(messages).find(([key]) => key.toLowerCase() === localized[1].toLowerCase())
      const translated = dictionary(message?.[1])?.message
      if (typeof translated !== 'string' || !translated.trim() || translated.length > 256) return invalidManifest()
      name = translated
    }
  } else if (/^__MSG_/i.test(name)) return invalidManifest()

  const options = dictionary(data.options_ui)
  if (data.options_ui !== undefined && !options) return invalidManifest()
  const optionsUI = options ? resource(options.page) : null
  const legacyOptions = data.options_page === undefined ? null : resource(data.options_page)
  icons(data.icons)
  for (const action of ['action', 'page_action', 'browser_action']) {
    const definition = dictionary(data[action])
    icons(definition?.default_icon)
    if (definition?.default_popup) resource(definition.default_popup)
  }
  const background = dictionary(data.background)
  if (data.background !== undefined) resource(background?.service_worker)
  for (const path of [data.devtools_page, dictionary(data.side_panel)?.default_path]) {
    if (path !== undefined) resource(path)
  }
  Object.values(dictionary(data.chrome_url_overrides) ?? {}).forEach(resource)
  strings(dictionary(data.sandbox)?.pages).forEach(resource)
  for (const rules of list(dictionary(data.declarative_net_request)?.rule_resources)) resource(dictionary(rules)?.path)
  for (const entry of list(data.web_accessible_resources)) {
    const declaration = dictionary(entry)
    if (!declaration) return invalidManifest()
    for (const path of strings(declaration.resources)) {
      if (!resourcePath(path.replaceAll('*', 'wildcard'))) return invalidManifest()
      if (!path.includes('*')) resource(path)
    }
  }

  const permissions = [...strings(data.permissions), ...strings(data.optional_permissions)]
  const sites = [...strings(data.host_permissions), ...strings(data.optional_host_permissions)]
  for (const script of list(data.content_scripts)) {
    const entry = dictionary(script)
    if (!entry) return invalidManifest()
    strings(entry.js).forEach(resource)
    strings(entry.css).forEach(resource)
    sites.push(...strings(entry.matches))
  }
  const isSite = (value: string) => value === '<all_urls>' || value.includes('://')
  sites.push(...permissions.filter(isSite))
  const declared = [...new Set(permissions.filter(permission => !isSite(permission)))]
  const hosts = [...new Set(sites)]
  if (declared.length + hosts.length > 512) return invalidManifest()
  return { manifest: { name, version: data.version, permissions: declared, sites: hosts, optionsPath: optionsUI ?? legacyOptions }, keyedIdentity }
}

const inside = (root: string, child: string) => {
  const path = relative(root, child)
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

async function scan(root: string, target?: string, signal?: AbortSignal) {
  let bytes = 0, entries = 0
  const files = new Map<string, Buffer | undefined>()
  const names = new Set<string>()
  const hashes: [string, string][] = []
  const buffer = Buffer.allocUnsafe(64 * 1024)

  async function readFile(path: string, name: string, stat: Stats) {
    if (!stat.isFile() || stat.nlink !== 1 || await realpath(path) !== path) return invalidPath()
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== stat.ino || opened.dev !== stat.dev || await realpath(path) !== path) return invalidPath()
      const save = target && !name.startsWith('_metadata/') ? await open(join(target, name), 'wx', 0o600) : undefined
      const chunks: Buffer[] = []
      const capture = name === 'manifest.json' || /^_locales\/[^/]+\/messages\.json$/.test(name)
      const hash = createHash('sha256')
      let size = 0
      try {
        while (true) {
          signal?.throwIfAborted()
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
          if (!bytesRead) break
          size += bytesRead
          bytes += bytesRead
          if (bytes > maxPackageBytes) return invalidPath()
          if (capture && size > maxManifestBytes) return invalidManifest()
          const chunk = buffer.subarray(0, bytesRead)
          hash.update(chunk)
          if (capture) chunks.push(Buffer.from(chunk))
          if (save) await save.writeFile(chunk)
        }
        const after = await handle.stat()
        if (size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) return invalidPath()
        if (!name.startsWith('_metadata/')) {
          hashes.push([name, hash.digest('hex')])
          files.set(name, capture ? Buffer.concat(chunks, size) : undefined)
        }
      } finally { await save?.close() }
    } finally { await handle.close() }
  }

  async function walk(path: string, prefix: string, depth: number): Promise<void> {
    signal?.throwIfAborted()
    if (depth > maxDepth || await realpath(path) !== path || !(await lstat(path)).isDirectory()) return invalidPath()
    for await (const entry of await opendir(path)) {
      signal?.throwIfAborted()
      if (++entries > maxEntries || !safeName(entry.name)) return invalidPath()
      const name = prefix + entry.name
      const folded = name.normalize('NFC').toLowerCase()
      if (names.has(folded)) return invalidPath()
      names.add(folded)
      const source = join(path, entry.name), stat = await lstat(source)
      if (stat.isDirectory()) {
        if (target && name !== '_metadata' && !name.startsWith('_metadata/')) await mkdir(join(target, name), { mode: 0o700 })
        await walk(source, name + '/', depth + 1)
      } else await readFile(source, name, stat)
    }
  }
  await walk(root, '', 0)
  hashes.sort(([a], [b]) => a < b ? -1 : a === b ? 0 : 1)
  return { ...manifestInfo(files), fingerprint: sha256(JSON.stringify(hashes)) }
}

export class BrowserExtensionInstaller {
  constructor(readonly store: BrowserExtensionStore) {}

  private async source(path: string) {
    try {
      if (!isAbsolute(path) || path.length > 4096 || /[\x00-\x1f]/.test(path) || !(await lstat(resolve(path))).isDirectory()) return invalidPath()
      const root = await realpath(path), managed = await realpath(this.store.root)
      if (inside(root, managed) || inside(managed, root)) return invalidPath()
      return root
    } catch { return invalidPath() }
  }

  async inspect(path: string) {
    await this.store.directories()
    return scan(await this.source(path))
  }

  async verify(record: InstalledExtension) {
    const path = await this.store.packagePath(record.id)
    const info = await scan(path)
    if (info.fingerprint !== record.fingerprint || (info.keyedIdentity ?? extensionIdentity(path)) !== record.identity) throw new ExtensionImportError('SOURCE_CHANGED')
    return path
  }

  async installManual(path: string, fingerprint: string): Promise<InstalledExtension> {
    return this.install(path, { fingerprint }) as Promise<InstalledExtension>
  }

  async installFromMCP(path: string, requestId: string, signal: AbortSignal): Promise<ExtensionInstallResult> {
    try { return await this.install(path, { requestId: requestId.toLowerCase() }, signal) as ExtensionInstallResult }
    catch (error) {
      signal.throwIfAborted()
      if (error instanceof ExtensionImportError && ['INVALID_PATH', 'INVALID_MANIFEST', 'PENDING_REMOVAL'].includes(error.code))
        return { status: error.code as 'INVALID_PATH' | 'INVALID_MANIFEST' | 'PENDING_REMOVAL' }
      return { status: 'INSTALL_FAILED' }
    }
  }

  private install(path: string, input: { fingerprint: string } | { requestId: string }, signal?: AbortSignal) {
    return this.store.locked(async (index, commit): Promise<InstalledExtension | ExtensionInstallResult> => {
      signal?.throwIfAborted()
      const requestId = 'requestId' in input ? input.requestId : undefined
      const pathDigest = sha256(path)
      const prior = requestId && index.receipts[requestId]
      if (prior) {
        if (prior.pathDigest !== pathDigest) return { status: 'REQUEST_CONFLICT' }
        const record = index.extensions.find(item => item.id === prior.result.extensionId)
        if (!record) return { status: 'REQUEST_STALE' }
        if (record.pendingRemoval) return { status: 'PENDING_REMOVAL' }
        return prior.result
      }

      const source = await this.source(path)
      const { packages, staging } = await this.store.directories()
      const id = randomUUID(), draft = join(staging, id), final = join(packages, id)
      await mkdir(draft, { mode: 0o700 })
      try {
        let info: Awaited<ReturnType<typeof scan>>
        try { info = await scan(source, draft, signal) }
        catch (error) {
          signal?.throwIfAborted()
          if (error instanceof ExtensionImportError) throw error
          if (['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return invalidPath()
          throw error
        }
        if ('fingerprint' in input && info.fingerprint !== input.fingerprint) throw new ExtensionImportError('SOURCE_CHANGED')
        const identity = info.keyedIdentity ?? extensionIdentity(final)
        if (reservedExtensionIds.has(identity)) return invalidManifest()
        const existing = index.extensions.find(item => item.fingerprint === info.fingerprint)
        if (existing?.pendingRemoval) throw new ExtensionImportError('PENDING_REMOVAL')
        if (existing) {
          if (!requestId) throw new ExtensionImportError('ALREADY_INSTALLED')
          const result = { status: 'ALREADY_INSTALLED', extensionId: existing.id, name: existing.name, version: existing.version, enabled: existing.enabled } as const
          index.receipts[requestId] = { pathDigest, result }
          signal?.throwIfAborted()
          commit()
          return result
        }
        const conflict = index.extensions.find(item => item.identity === identity)
        if (conflict?.pendingRemoval) throw new ExtensionImportError('PENDING_REMOVAL')
        if (conflict) return invalidManifest()
        const record: InstalledExtension = { ...info.manifest, id, source: requestId ? 'mcp' : 'manual', enabled: !requestId,
          fingerprint: info.fingerprint, identity, runtimeId: null, installedAt: new Date().toISOString(), pendingRemoval: false }
        index.extensions.push(record)
        const result = { status: 'INSTALLED_DISABLED', extensionId: id, name: record.name, version: record.version, enabled: false,
          requiresUserAction: true, nextAction: 'ENABLE_IN_SETTINGS' } as const
        if (requestId) index.receipts[requestId] = { pathDigest, result }
        signal?.throwIfAborted()
        await rename(draft, final)
        try { signal?.throwIfAborted(); commit() }
        catch (error) { await rm(final, { recursive: true, force: true }); throw error }
        return requestId ? result : record
      } finally { await rm(draft, { recursive: true, force: true }).catch(() => {}) }
    })
  }
}
