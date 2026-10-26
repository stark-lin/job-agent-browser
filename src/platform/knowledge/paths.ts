import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { knowledgePath, KnowledgeError } from '../../domain/knowledge'
export const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
export async function safePath(root: string, input: string, allowRoot = false) {
  const path = knowledgePath(input, allowRoot)
  const base = await lstat(root)
  if (!base.isDirectory() || base.isSymbolicLink()) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
  let current = root
  for (const part of path ? path.split('/') : []) {
    current = join(current, part)
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
  return current
}
export async function atomicWrite(path: string, content: string) {
  const temporary = `${path}.${randomUUID()}.tmp`
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file = await open(temporary, 'wx', 0o600)
    await file.writeFile(content, 'utf8')
    await file.sync()
    await file.close()
    file = undefined
    await rename(temporary, path)
    try {
      const dir = await open(dirname(path), 'r')
      try {
        await dir.sync()
      } finally {
        await dir.close()
      }
    } catch {
      /* Directory fsync is unavailable on some platforms. */
    }
  } finally {
    await file?.close()
    await unlink(temporary).catch(() => {})
  }
}
export async function ensureKnowledge(directory: string) {
  const root = join(directory, 'knowledge')
  let fresh = false
  try {
    await mkdir(root, { mode: 0o700 })
    fresh = true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
  await safePath(root, '', true)
  if (fresh) {
    const f = await open(join(root, 'README.md'), 'wx', 0o600)
    try {
      await f.writeFile('# Knowledge\n')
    } finally {
      await f.close()
    }
  }
  return root
}
