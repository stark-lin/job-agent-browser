import { resolve } from 'node:path'
import type { composeBackend } from '../database/backend'
import type { ResumeDocument } from '../../domain/resume/resume.types'
import { fail } from '../../domain/common/errors'
import { abortable } from '../../shared/agent'
import { artifactFiles, OutputFailure } from './files'

export type ResumeRenderer = (document: ResumeDocument, fonts: string, signal: AbortSignal) => Promise<{ html: string; pdf: Uint8Array; pages: number }>
/** Shared output lifecycle; render adapters never receive a database or output path. */
export function createResumeOutput(backend: ReturnType<typeof composeBackend>, directory: string, fonts: string, render: ResumeRenderer) {
  const files = artifactFiles(directory)
  const artifact = (id: string) => backend.resumes.getArtifact({ id }).artifact
  const active = new Set<Promise<unknown>>()
  async function build(id: string, signal: AbortSignal, started?: () => void) {
    signal.throwIfAborted()
    const { original, token } = backend.outputTransaction.write(() => ({
      original: backend.artifactForOutput(id), token: backend.lease.claim('output', id)
    }))
    const owned = () => backend.lease.valid('output', id, token)
    const valid = () => { signal.throwIfAborted(); owned() }
    try {
      backend.generation.commitOutput(id, original.revision, { status: 'RUNNING', error: null, pages: null }, [], valid)
      started?.()
      const result = await abortable(render(original.content, fonts, signal), signal)
      valid()
      const written = await files.write(id, result, signal, token)
      backend.generation.commitOutput(id, original.revision, { status: 'READY', error: null, pages: result.pages }, written, valid)
    } catch {
      try {
        backend.generation.commitOutput(id, original.revision,
          { status: signal.aborted ? 'CANCELLED' : 'FAILED', error: signal.aborted ? null : 'OUTPUT_FAILED', pages: null }, [], owned)
      } catch { /* Recovery owns unavailable/expired instances. */ }
    } finally { backend.lease.release('output', id, token) }
    const current = artifact(id)
    return { artifactId: id, output: current.output, files: current.output.status === 'READY'
      ? current.outputFiles.map(file => ({ ...file, path: resolve(directory, file.relativePath) })) : [] }
  }
  return {
    build(id: string, signal: AbortSignal, started?: () => void) {
      const pending = build(id, signal, started)
      active.add(pending)
      void pending.then(() => active.delete(pending), () => active.delete(pending))
      return pending
    },
    async settle() { await Promise.allSettled([...active]) },
    async read(id: string, format: 'HTML' | 'PDF') {
      const current = artifact(id), file = current.outputFiles.find(file => file.format === format)
      if (!file || current.output.status !== 'READY') fail('INVALID_STATE')
      let bytes: Buffer
      const unchanged = (latest: typeof current) => latest.revision === current.revision && latest.output.status === 'READY'
        && latest.outputFiles.some(output => output.format === format && output.relativePath === file.relativePath)
      try { bytes = await files.read(file.relativePath) } catch {
        backend.generation.commitOutput(id, current.revision, { status: 'FAILED', error: 'OUTPUT_MISSING', pages: null }, [], () => {
          backend.lease.available('output', id)
          if (!unchanged(backend.artifactForOutput(id))) fail('CONFLICT')
        })
        throw new OutputFailure('OUTPUT_MISSING')
      }
      if (!unchanged(artifact(id))) fail('CONFLICT')
      return { bytes, revision: current.revision, pages: current.output.pages! }
    }
  }
}
