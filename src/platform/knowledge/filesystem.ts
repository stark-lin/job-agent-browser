import { lstat, readdir, readFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import lockfile from 'proper-lockfile'
import {
  KnowledgeError,
  markdownPath,
  revision,
  MAX_FILE_BYTES,
  type KnowledgeNode,
  type KnowledgeFile
} from '../../domain/knowledge'
import { atomicWrite, ensureKnowledge, safePath, hash } from './paths'
export class KnowledgeFiles {
  readonly root: string
  constructor(readonly directory: string) {
    this.root = join(directory, 'knowledge')
  }
  async initialize() {
    await ensureKnowledge(this.directory)
  }
  async locked<T>(operation: () => Promise<T>, recovery = false): Promise<T> {
    await this.initialize()
    const release = await lockfile
      .lock(this.root, {
        realpath: false,
        stale: 30000,
        update: 5000,
        retries: { retries: 50, minTimeout: 40, maxTimeout: 100 }
      })
      .catch(() => {
        throw new KnowledgeError('KNOWLEDGE_BUSY')
      })
    try {
      if (!recovery) {
        try {
          await stat(join(this.directory, 'knowledge-runtime', 'restore.json'))
          throw new KnowledgeError('KNOWLEDGE_RECOVERY_REQUIRED')
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        }
      }
      return await operation()
    } finally {
      await release()
    }
  }
  async read(input: string): Promise<KnowledgeFile> {
    const path = markdownPath(input),
      physical = await safePath(this.root, path)
    try {
      const info = await lstat(physical)
      if (!info.isFile()) throw new KnowledgeError('KNOWLEDGE_UNSUPPORTED_FILE')
      if (info.size > MAX_FILE_BYTES) throw new KnowledgeError('KNOWLEDGE_TOO_LARGE')
      const bytes = await readFile(physical)
      if (bytes.length > MAX_FILE_BYTES) throw new KnowledgeError('KNOWLEDGE_TOO_LARGE')
      let content: string
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new KnowledgeError('KNOWLEDGE_UNSUPPORTED_FILE')
      }
      return { path, content, revision: hash(bytes) }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new KnowledgeError('KNOWLEDGE_NOT_FOUND')
      throw e
    }
  }
  async tree(): Promise<KnowledgeNode> {
    await this.initialize()
    let count = 0
    const walk = async (path: string, depth: number): Promise<KnowledgeNode> => {
      if (++count > 10000 || depth > 32) throw new KnowledgeError('KNOWLEDGE_TOO_LARGE')
      const physical = await safePath(this.root, path, true),
        info = await lstat(physical)
      if (info.isFile()) {
        const f = await this.read(path)
        return { type: 'file', path, name: basename(path), revision: f.revision }
      }
      const children: KnowledgeNode[] = []
      for (const entry of (await readdir(physical, { withFileTypes: true })).sort(
        (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
      )) {
        if (
          entry.name.startsWith('.') ||
          entry.isSymbolicLink() ||
          !(entry.isDirectory() || (entry.isFile() && /\.md$/i.test(entry.name)))
        )
          continue
        children.push(await walk(path ? `${path}/${entry.name}` : entry.name, depth + 1))
      }
      return {
        type: 'directory',
        path,
        name: basename(path) || 'KNOWLEDGE',
        children,
        revision: hash(JSON.stringify(children)),
        ...(children.find((c) => c.type === 'file' && c.name === 'README.md')
          ? { readme: children.find((c) => c.type === 'file' && c.name === 'README.md')!.path }
          : {})
      }
    }
    return walk('', 0)
  }
  async check(path: string, expected: string | null) {
    revision(expected)
    let actual: string | null = null
    try {
      const info = await lstat(await safePath(this.root, path))
      actual = info.isDirectory() ? (await this.node(path)).revision : (await this.read(path)).revision
    } catch (e) {
      if (
        !(e instanceof KnowledgeError && e.code === 'KNOWLEDGE_NOT_FOUND') &&
        (e as NodeJS.ErrnoException).code !== 'ENOENT'
      )
        throw e
    }
    if (expected !== actual) throw new KnowledgeError('KNOWLEDGE_CONFLICT')
  }
  async node(path: string) {
    const find = (n: KnowledgeNode): KnowledgeNode | undefined =>
      n.path === path ? n : n.children?.map(find).find(Boolean)
    const node = find(await this.tree())
    if (!node) throw new KnowledgeError('KNOWLEDGE_NOT_FOUND')
    return node
  }
  async write(path: string, content: string, expectedRevision: string | null, signal?: AbortSignal) {
    markdownPath(path)
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_FILE_BYTES)
      throw new KnowledgeError('KNOWLEDGE_TOO_LARGE')
    return this.locked(async () => {
      signal?.throwIfAborted()
      await this.check(path, expectedRevision)
      const target = await safePath(this.root, path)
      // Parents must exist; creating a note must not implicitly create a hierarchy.
      if (!(await lstat(dirname(target))).isDirectory()) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
      await this.check(path, expectedRevision)
      signal?.throwIfAborted()
      await atomicWrite(await safePath(this.root, path), content)
      return { path, content, revision: hash(content) }
    })
  }
  async mkdir(path: string, signal?: AbortSignal) {
    return this.locked(async () => {
      signal?.throwIfAborted()
      const target = await safePath(this.root, path)
      try {
        await mkdir(target)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new KnowledgeError('KNOWLEDGE_CONFLICT')
        throw e
      }
      return this.node(path)
    })
  }
  async move(source: string, target: string, expectedRevision: string, signal?: AbortSignal) {
    return this.locked(async () => {
      signal?.throwIfAborted()
      const from = await safePath(this.root, source),
        to = await safePath(this.root, target)
      if (target === source || target.startsWith(source + '/')) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
      await this.check(source, expectedRevision)
      if ((await lstat(from)).isFile()) markdownPath(target)
      try {
        await lstat(to)
        throw new KnowledgeError('KNOWLEDGE_CONFLICT')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
      await this.assertManaged(source)
      signal?.throwIfAborted()
      await rename(from, to)
      return this.node(target)
    })
  }
  async assertManaged(path: string) {
    const physical = await safePath(this.root, path),
      info = await lstat(physical)
    if (info.isFile()) {
      markdownPath(path)
      return
    }
    if (!info.isDirectory()) throw new KnowledgeError('KNOWLEDGE_UNSUPPORTED_FILE')
    for (const entry of await readdir(physical)) await this.assertManaged(`${path}/${entry}`)
  }
  async delete(path: string, expectedRevision: string, recursive: boolean, signal?: AbortSignal) {
    return this.locked(async () => {
      signal?.throwIfAborted()
      const target = await safePath(this.root, path)
      await this.check(path, expectedRevision)
      await this.assertManaged(path)
      if ((await lstat(target)).isDirectory() && !recursive) throw new KnowledgeError('KNOWLEDGE_CONFLICT')
      signal?.throwIfAborted()
      await rm(target, { recursive })
      return null
    })
  }
}
