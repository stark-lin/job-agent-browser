import { mkdir, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises'
import { join, resolve, dirname, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { id } from '../../domain/common/validation'
import type { OutputFile } from '../../domain/resume/resume.types'

export class OutputFailure extends Error { constructor(readonly code: 'OUTPUT_MISSING') { super(code) } }

export function artifactFiles(root: string) {
  const path = (relative: string) => {
    if (!/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('INVALID_OUTPUT_PATH')
    const target = resolve(root, relative)
    if (!target.startsWith(resolve(root) + sep)) throw new Error('INVALID_OUTPUT_PATH')
    return target
  }
  async function safe(relative: string) {
    const target = path(relative)
    for (let current = dirname(target); current.startsWith(resolve(root)); current = dirname(current)) {
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('INVALID_OUTPUT_PATH') }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error }
      if (current === resolve(root)) break
    }
    try { if ((await lstat(target)).isSymbolicLink()) throw new Error('INVALID_OUTPUT_PATH') }
    catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error }
    return target
  }
  return {
    async write(artifactId: string, result: { html: string; pdf: Uint8Array }, signal: AbortSignal, attempt?: string): Promise<OutputFile[]> {
      id(artifactId)
      if (attempt !== undefined) id(attempt)
      const files: OutputFile[] = []
      for (const format of ['HTML', 'PDF'] as const) {
        signal.throwIfAborted()
        const relativePath = `${artifactId}/${attempt ? attempt + '/' : ''}default-v1.${format.toLowerCase()}`, target = await safe(relativePath)
        await mkdir(dirname(target), { recursive: true, mode: 0o700 })
        const temporary = join(dirname(target), `${randomUUID()}.tmp`)
        try {
          await writeFile(temporary, format === 'HTML' ? result.html : result.pdf, { mode: 0o600, flag: 'wx' })
          signal.throwIfAborted(); await rename(temporary, target)
          files.push({ format, relativePath })
        } finally { await rm(temporary, { force: true }) }
      }
      return files
    },
    async read(relative: string) { return readFile(await safe(relative)) }
  }
}
