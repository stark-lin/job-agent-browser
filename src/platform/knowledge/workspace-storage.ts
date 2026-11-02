import fs from 'node:fs'
import { cp, open, lstat, mkdir, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import git from 'isomorphic-git'
import lockfile from 'proper-lockfile'
import { KnowledgeError } from '../../domain/knowledge'
import { atomicWrite, hash } from './paths'
import { KnowledgeFiles } from './filesystem'
import { KnowledgeBackup } from './git/backup'
import { defaultKnowledgePreferences } from '../../shared/knowledge-settings'
export interface WorkspaceLayout { generation: 1; originalHead: string | null; migrationCommit: string; legacyCommits: string[] }
export interface WorkspaceStorage {
  root: string; runtime: string; lock: string; layout: WorkspaceLayout; ready: Promise<void>
}
interface MigrationJournal {
  phase: 'copy' | 'prepared' | 'archived' | 'published'
  manifest: Record<string, string>; source?: Record<string, string>; hadLegacy?: boolean; layout?: WorkspaceLayout
}
const exists = async (path: string) => { try { await lstat(path); return true } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e } }
/** Reject links and special files, including inside .git; preserve every regular byte. */
async function manifest(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const walk = async (path: string) => {
    const info = await lstat(join(root, path))
    if (info.isSymbolicLink()) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
    if (info.isDirectory()) {
      for (const name of (await readdir(join(root, path))).sort()) {
        if (/[\\\x00-\x1f:*?"<>|]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || (name === '.git' && path !== '')) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
        await walk(path ? `${path}/${name}` : name)
      }
    } else if (info.isFile()) result[path] = hash(await readFile(join(root, path)))
    else throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
  }
  await walk(''); return result
}
async function syncDirectory(path: string) {
  try { const dir = await open(path, 'r'); try { await dir.sync() } finally { await dir.close() } }
  catch (error) { if (!['EINVAL', 'EISDIR', 'EPERM', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
}
async function syncTree(path: string): Promise<void> {
  const info = await lstat(path)
  if (info.isDirectory()) {
    for (const name of await readdir(path)) await syncTree(join(path, name))
    await syncDirectory(path)
  } else {
    const file = await open(path, 'r'); try { await file.sync() } finally { await file.close() }
  }
}
async function publishRename(source: string, target: string) { await rename(source, target); await syncDirectory(dirname(target)) }
export type MigrationStep = 'copy' | 'staged' | 'prepared' | 'archived' | 'published' | 'marked'
export function createWorkspaceStorage(directory: string, owner: boolean, checkpoint?: (step: MigrationStep) => void): WorkspaceStorage {
  const runtime = join(directory, 'smart-note-runtime'), root = join(directory, 'smart-note')
  const storage: WorkspaceStorage = { root, runtime, lock: join(runtime, 'workspace'), layout: undefined!, ready: undefined! }
  storage.ready = (async () => {
    await mkdir(runtime, { recursive: true, mode: 0o700 })
    const runtimeInfo = await lstat(runtime)
    if (!runtimeInfo.isDirectory() || runtimeInfo.isSymbolicLink()) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
    const legacy = join(directory, 'knowledge'), stage = join(directory, 'smart-note-staging'), archive = join(directory, 'knowledge-archive-v1')
    const marker = 'Smart Note migrated to smart-note/. Start the current JAB version.\n'
    const marked = async () => await exists(legacy) && (await lstat(legacy)).isFile() && !(await lstat(legacy)).isSymbolicLink() && await readFile(legacy, 'utf8') === marker
    const mark = async () => {
      if (await exists(legacy)) { if (!(await marked())) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED'); return }
      const placeholder = await open(legacy, 'wx', 0o600)
      try { await placeholder.writeFile(marker); await placeholder.sync() } finally { await placeholder.close() }
      await syncDirectory(directory)
    }
    const layoutPath = join(runtime, 'layout.json'), journalPath = join(runtime, 'migration.json')
    const load = async () => {
      const layout = JSON.parse(await readFile(layoutPath, 'utf8')) as WorkspaceLayout
      if (layout.generation !== 1 || !/^[a-f0-9]{40}$/.test(layout.migrationCommit) || !Array.isArray(layout.legacyCommits) || layout.legacyCommits.some(c => !/^[a-f0-9]{40}$/.test(c))) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
      for (const path of [root, join(root, '.git'), join(root, 'knowledge'), join(root, 'memory')]) {
        const info = await lstat(path)
        if (!info.isDirectory() || info.isSymbolicLink()) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
      }
      if (!(await marked())) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
      const options = { fs, dir: root }
      await git.readCommit({ ...options, oid: layout.migrationCommit })
      if (layout.originalHead && !(await git.isDescendent({ ...options, oid: layout.migrationCommit, ancestor: layout.originalHead }))) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
      storage.layout = layout
    }
    if (!owner) {
      if (await exists(journalPath) || await exists(join(runtime, 'restore.json')) || !(await exists(layoutPath))) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
      await load(); return
    }
    const release = await lockfile.lock(storage.lock, { realpath: false, stale: 30000, retries: { retries: 50, minTimeout: 40, maxTimeout: 100 } })
    try {
      if (await exists(layoutPath) && !(await exists(journalPath))) { await load(); return }
      let journal: MigrationJournal
      if (await exists(journalPath)) journal = JSON.parse(await readFile(journalPath, 'utf8')) as MigrationJournal
      else {
        if (await exists(root) || await exists(stage) || await exists(archive)) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
        journal = { phase: 'copy', manifest: {} }
        await atomicWrite(journalPath, JSON.stringify(journal))
      }
      checkpoint?.('copy')
      if (!['copy', 'prepared', 'archived', 'published'].includes(journal.phase)) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
      if (journal.phase === 'copy') {
        let oldRelease: (() => Promise<void>) | undefined
        try {
          const hadLegacy = await exists(legacy)
          if (hadLegacy) {
            // Complete the old restore before freezing the old library.
            const files = new KnowledgeFiles(directory)
            const backup = new KnowledgeBackup(files, () => defaultKnowledgePreferences)
            await backup.recover()
            oldRelease = await lockfile.lock(legacy, { realpath: false, stale: 30000, retries: { retries: 50, minTimeout: 40, maxTimeout: 100 } })
          }
          // A partial copy is never published. Recheck the source before replacing staging.
          const original = hadLegacy ? await manifest(legacy) : {}
          journal.source = original; journal.hadLegacy = hadLegacy
          await atomicWrite(journalPath, JSON.stringify(journal))
          if (await exists(stage)) {
            // Only a journal-owned, safe staging tree may be discarded.
            await manifest(stage)
            await fs.promises.rm(stage, { recursive: true })
          }
          await mkdir(stage, { mode: 0o700 })
          await mkdir(join(stage, 'knowledge'))
          if (hadLegacy) for (const name of await readdir(legacy)) {
            await cp(join(legacy, name), join(stage, name === '.git' ? '.git' : `knowledge/${name}`), { recursive: true, dereference: false, errorOnExist: true, force: false })
          }
          const options = { fs, dir: stage }
          if (!(await exists(join(stage, '.git')))) await git.init({ ...options, defaultBranch: 'main' })
          let originalHead: string | null = null
          try { originalHead = await git.resolveRef({ ...options, ref: 'HEAD' }) } catch { /* New repository. */ }
          const legacyCommits = originalHead ? (await git.log(options)).map(c => c.oid) : []
          await mkdir(join(stage, 'memory'))
          if (!(await exists(join(stage, 'knowledge/README.md')))) await atomicWrite(join(stage, 'knowledge/README.md'), '# Knowledge\n')
          await atomicWrite(join(stage, 'memory/README.md'), '# Memory\n')
          checkpoint?.('staged')
          const copied = await manifest(stage)
          for (const [path, digest] of Object.entries(original)) {
            if (copied[path.startsWith('.git/') ? path : `knowledge/${path}`] !== digest) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
          }
          for (const [path, , work] of await git.statusMatrix(options)) {
            if (work) await git.add({ ...options, filepath: path })
            else await git.remove({ ...options, filepath: path })
          }
          const migrationCommit = await git.commit({ ...options, message: 'Migrate Smart Note to Knowledge and Memory spaces', author: { name: 'Smart Note', email: 'smart-note@local.invalid' } })
          if (originalHead && !(await git.isDescendent({ ...options, oid: migrationCommit, ancestor: originalHead }))) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
          if (hadLegacy && JSON.stringify(await manifest(legacy)) !== JSON.stringify(original)) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
          await syncTree(stage); await syncDirectory(directory)
          journal = { phase: 'prepared', manifest: await manifest(stage), source: original, hadLegacy, layout: { generation: 1, originalHead, migrationCommit, legacyCommits } }
          await atomicWrite(journalPath, JSON.stringify(journal))
          checkpoint?.('prepared')
          if (hadLegacy) await publishRename(legacy, archive)
          await mark()
          journal.phase = 'archived'; await atomicWrite(journalPath, JSON.stringify(journal)); checkpoint?.('archived')
        } finally { await oldRelease?.() }
      }
      if (journal.phase === 'prepared') {
        if (JSON.stringify(await manifest(stage)) !== JSON.stringify(journal.manifest)) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
        const oldRelease = await lockfile.lock(legacy, { realpath: false, stale: 30000, retries: { retries: 50, minTimeout: 40, maxTimeout: 100 } })
        try {
          if (await exists(legacy) && !(await marked())) {
            if (JSON.stringify(await manifest(legacy)) !== JSON.stringify(journal.source) || await exists(archive)) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
            await publishRename(legacy, archive)
          } else if (journal.hadLegacy && (!(await exists(archive)) || JSON.stringify(await manifest(archive)) !== JSON.stringify(journal.source))) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
          await mark()
        } finally { await oldRelease() }
        journal.phase = 'archived'; await atomicWrite(journalPath, JSON.stringify(journal)); checkpoint?.('archived')
      }
      if (journal.phase === 'archived') {
        if (await exists(stage)) {
          if (await exists(root) || JSON.stringify(await manifest(stage)) !== JSON.stringify(journal.manifest)) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
          await publishRename(stage, root)
        } else if (!(await exists(root)) || JSON.stringify(await manifest(root)) !== JSON.stringify(journal.manifest)) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
        journal.phase = 'published'; await atomicWrite(journalPath, JSON.stringify(journal)); checkpoint?.('published')
      }
      if (!journal.layout) throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
      // A regular file intentionally makes old ensureKnowledge/safePath reject this entry.
      await mark()
      checkpoint?.('marked')
      await atomicWrite(layoutPath, JSON.stringify(journal.layout))
      await load(); await unlink(journalPath)
    } finally { await release() }
  })()
  storage.ready.catch(() => {})
  return storage
}
