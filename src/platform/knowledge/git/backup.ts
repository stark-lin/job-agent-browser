import fs from 'node:fs'
import { mkdir, lstat, readFile, unlink, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import { randomUUID } from 'node:crypto'
import type { KnowledgePreferences } from '../../../shared/knowledge-settings'
import {
  KnowledgeError,
  MAX_FILE_BYTES,
  markdownPath,
  type BackupVersion,
  type BackupStatus
} from '../../../domain/knowledge'
import { KnowledgeFiles } from '../filesystem'
import { atomicWrite, safePath, hash } from '../paths'
interface RestoreJournal {
  commit: string
  before: Record<string, string>
  after: Record<string, string>
}
export class KnowledgeBackup {
  readonly abort = new AbortController()
  private state: BackupStatus = { dirty: false, state: 'local' }
  constructor(
    readonly files: KnowledgeFiles,
    private preferences: () => KnowledgePreferences,
    private token: () => string | null = () => null,
    private transport: typeof http = http
  ) {}
  private get options() {
    return { fs, dir: this.files.root }
  }
  private get journal() {
    return join(this.files.directory, 'knowledge-runtime', 'restore.json')
  }
  async initialize() {
    await this.files.initialize()
    const path = join(this.files.root, '.git')
    try {
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      await git.init({ ...this.options, defaultBranch: 'main' })
    }
    const inspect = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
        if (entry.isDirectory()) await inspect(join(directory, entry.name))
      }
    }
    await inspect(path)
  }
  private async head() {
    try {
      return await git.resolveRef({ ...this.options, ref: 'HEAD' })
    } catch {
      return null
    }
  }
  private async snapshot(reason: string) {
    await this.initialize()
    const tree = await this.files.tree(),
      managed = new Set<string>()
    const collect = (n: typeof tree) => {
      if (n.type === 'file') managed.add(n.path)
      n.children?.forEach(collect)
    }
    collect(tree)
    let changed = false
    for (const [path, head, work, stage] of await git.statusMatrix(this.options)) {
      if (path.split('/').some((part) => part.startsWith('.')) || !/\.md$/i.test(path)) continue
      markdownPath(path)
      if (head === work && work === stage) continue
      if (managed.has(path)) await git.add({ ...this.options, filepath: path })
      else if (!work) await git.remove({ ...this.options, filepath: path })
      else throw new KnowledgeError('KNOWLEDGE_UNSUPPORTED_FILE')
      changed = true
    }
    const current = await this.head()
    if (!changed && current) return current
    const commit = await git.commit({
      ...this.options,
      message: reason,
      author: { name: 'Knowledge Backup', email: 'knowledge@local.invalid' }
    })
    if (this.state.state === 'synced') this.state = { dirty: false, state: 'local' }
    return commit
  }
  async backup(reason = 'Automatic backup') {
    return this.files.locked(() => this.snapshot(reason))
  }
  async status(): Promise<BackupStatus> {
    try {
      await this.initialize()
      const dirty = (await git.statusMatrix(this.options)).some(
        ([p, h, w, s]) => /\.md$/i.test(p) && !p.startsWith('.') && (h !== w || w !== s)
      )
      return { ...this.state, dirty }
    } catch {
      return { dirty: true, state: 'failed', error: 'KNOWLEDGE_UNAVAILABLE' }
    }
  }
  async versionFiles(commit: string) {
    await this.initialize()
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
    const result: Record<string, string> = {}
    let bytes = 0
    const walk = async (oid: string, prefix: string) => {
      const { tree } = await git.readTree({ ...this.options, oid })
      for (const entry of tree) {
        const path = prefix + entry.path
        if (entry.type === 'tree') {
          markdownPath(path + '/README.md')
          await walk(entry.oid, path + '/')
        } else {
          markdownPath(path)
          if (!['100644', '100755'].includes(entry.mode)) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
          const { blob } = await git.readBlob({ ...this.options, oid: entry.oid })
          bytes += blob.length
          if (blob.length > MAX_FILE_BYTES || bytes > 16 * 1024 * 1024 || Object.keys(result).length >= 10000)
            throw new KnowledgeError('KNOWLEDGE_TOO_LARGE')
          result[path] = new TextDecoder('utf-8', { fatal: true }).decode(blob)
        }
      }
    }
    const { commit: object } = await git.readCommit({ ...this.options, oid: commit })
    await walk(object.tree, '')
    return result
  }
  async history(offset = 0, limit = 25): Promise<BackupVersion[]> {
    await this.initialize()
    if (!(await this.head())) return []
    const entries = (await git.log({ ...this.options, depth: offset + limit })).slice(offset, offset + limit)
    const result: BackupVersion[] = []
    for (const entry of entries) {
      const current = await this.versionFiles(entry.oid),
        parent = entry.commit.parent[0] ? await this.versionFiles(entry.commit.parent[0]) : {}
      const files = [...new Set([...Object.keys(current), ...Object.keys(parent)])].filter(
        (p) => current[p] !== parent[p]
      )
      result.push({
        commit: entry.oid,
        timestamp: new Date(entry.commit.committer.timestamp * 1000).toISOString(),
        reason: entry.commit.message.trim(),
        files
      })
    }
    return result
  }
  private async capture() {
    const result: Record<string, string> = {},
      root = await this.files.tree()
    const walk = async (n: typeof root) => {
      if (n.type === 'file') result[n.path] = (await this.files.read(n.path)).content
      for (const c of n.children ?? []) await walk(c)
    }
    await walk(root)
    return result
  }
  private async apply(journal: RestoreJournal) {
    const paths = [...new Set([...Object.keys(journal.before), ...Object.keys(journal.after)])]
    // Preflight every path before mutating anything. Recovery accepts either the old or intended version.
    for (const p of paths) {
      markdownPath(p)
      let current: string | undefined
      try {
        current = (await this.files.read(p)).content
      } catch (e) {
        if (!(e instanceof KnowledgeError && e.code === 'KNOWLEDGE_NOT_FOUND')) throw e
      }
      if (current !== journal.before[p] && current !== journal.after[p])
        throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
    }
    for (const p of paths) {
      let current: string | undefined
      try {
        current = (await this.files.read(p)).content
      } catch (e) {
        if (!(e instanceof KnowledgeError && e.code === 'KNOWLEDGE_NOT_FOUND')) throw e
      }
      if (current === journal.after[p]) continue
      if (current !== journal.before[p]) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
      const physical = await safePath(this.files.root, p)
      if (journal.after[p] === undefined) await unlink(physical)
      else {
        await mkdir(dirname(physical), { recursive: true })
        await safePath(this.files.root, p)
        await atomicWrite(physical, journal.after[p])
      }
    }
  }
  async restore(commit: string, expectedRevision: string) {
    return this.files.locked(async () => {
      if ((await this.files.tree()).revision !== expectedRevision) throw new KnowledgeError('KNOWLEDGE_CONFLICT')
      const after = await this.versionFiles(commit),
        before = await this.capture()
      await this.snapshot('Before restore')
      const journal = { commit, before, after }
      await mkdir(dirname(this.journal), { recursive: true, mode: 0o700 })
      await atomicWrite(this.journal, JSON.stringify(journal))
      await this.apply(journal)
      await this.snapshot(`Restore ${commit.slice(0, 8)}`)
      await unlink(this.journal)
      return null
    })
  }
  async recover() {
    let raw: string
    try {
      raw = await readFile(this.journal, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
      throw e
    }
    const j = JSON.parse(raw) as RestoreJournal
    if (
      !j ||
      typeof j.commit !== 'string' ||
      !j.before ||
      !j.after ||
      [...Object.values(j.before), ...Object.values(j.after)].some((v) => typeof v !== 'string')
    )
      throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
    await this.files.locked(async () => {
      await this.apply(j)
      await this.snapshot(`Recover restore ${j.commit.slice(0, 8)}`)
      await unlink(this.journal)
    }, true)
  }
  async sync() {
    return this.files
      .locked(async () => {
        const config = this.preferences()
        if (!config.remote) {
          await this.snapshot('Manual backup')
          return (this.state = { dirty: false, state: 'local' })
        }
        const url = new URL(config.remote)
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'github.com' ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !/^\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(url.pathname)
        )
          throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
        const key = this.token()
        if (!key) throw new KnowledgeError('KNOWLEDGE_UNAVAILABLE')
        const auth = {
          http: {
            request: (request: Parameters<typeof http.request>[0]) => {
              if (new URL(request.url).origin !== url.origin) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
              return this.transport.request({
                ...request,
                fetchOptions: { ...request.fetchOptions, maxRedirects: 0 },
                signal: AbortSignal.any([
                  this.abort.signal,
                  AbortSignal.timeout(30000),
                  ...(request.signal ? [request.signal] : [])
                ])
              })
            }
          },
          onAuth: (requestURL: string) => {
            if (new URL(requestURL).origin !== url.origin) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
            return { username: key, password: 'x-oauth-basic' }
          }
        }
        const local = await this.snapshot('Before sync'),
          branch = config.branch
        await git.addRemote({ ...this.options, remote: 'origin', url: config.remote, force: true })
        let remote: string | undefined
        const refs = await git.listServerRefs({ ...this.options, ...auth, url: config.remote, prefix: 'refs/heads/' })
        remote = refs.find((r) => r.ref === `refs/heads/${branch}`)?.oid
        if (remote)
          await git.fetch({ ...this.options, ...auth, remote: 'origin', ref: branch, singleBranch: true, tags: false })
        if (
          remote &&
          remote !== local &&
          !(await git.isDescendent({ ...this.options, oid: local, ancestor: remote }))
        ) {
          if (await git.isDescendent({ ...this.options, oid: remote, ancestor: local })) {
            const before = await this.capture(),
              after = await this.versionFiles(remote)
            const journal = { commit: remote, before, after }
            await mkdir(dirname(this.journal), { recursive: true, mode: 0o700 })
            await atomicWrite(this.journal, JSON.stringify(journal))
            await this.apply(journal)
            // Keep published history intact while advancing the local ref to the fetched descendant.
            await git.writeRef({ ...this.options, ref: 'refs/heads/main', value: remote, force: true })
            for (const filepath of new Set([...Object.keys(before), ...Object.keys(after)]))
              await git.resetIndex({ ...this.options, filepath })
            await unlink(this.journal)
            return (this.state = { dirty: false, state: 'synced' })
          }
          const conflictBranch = `backup/conflict-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
          await git.branch({ ...this.options, ref: conflictBranch, object: local })
          await git.writeRef({
            ...this.options,
            ref: `refs/heads/backup/remote-${hash(remote).slice(0, 12)}`,
            value: remote,
            force: true
          })
          try {
            await git.push({
              ...this.options,
              ...auth,
              remote: 'origin',
              ref: conflictBranch,
              remoteRef: conflictBranch
            })
            return (this.state = { dirty: false, state: 'conflict', conflictBranch })
          } catch {
            return (this.state = { dirty: false, state: 'failed', conflictBranch, error: 'CONFLICT_UPLOAD_FAILED' })
          }
        }
        await git.push({ ...this.options, ...auth, remote: 'origin', ref: 'main', remoteRef: branch })
        return (this.state = { dirty: false, state: 'synced' })
      })
      .catch(() => (this.state = { dirty: true, state: 'failed', error: 'SYNC_FAILED' }))
  }
}
