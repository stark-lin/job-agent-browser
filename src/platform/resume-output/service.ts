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
    const original = artifact(id), version = JSON.stringify(original.content)
    const token = backend.outputTransaction.write({ event: 'ARTIFACT_OUTPUT_CLAIM', action: 'UPDATE', target: 'artifact', targetId: id }, () => backend.lease.claim('output', id))
    const valid = () => { signal.throwIfAborted(); backend.lease.valid('output', id, token); if (JSON.stringify(artifact(id).content) !== version) fail('CONFLICT') }
    try {
      valid()
      backend.generation.recordOutputState({ id, output: { status: 'RUNNING', error: null, pages: null } })
      started?.()
      const result = await abortable(render(original.content, fonts, signal), signal)
      valid()
      const written = await files.write(id, result, signal, token)
      valid()
      backend.generation.recordOutputFiles({ id, files: written })
      backend.generation.recordOutputState({ id, output: { status: 'READY', error: null, pages: result.pages } })
    } catch {
      // An expired or replaced worker cannot overwrite its successor's state.
      try {
        backend.lease.valid('output', id, token)
        backend.generation.recordOutputState({ id, output: { status: signal.aborted ? 'CANCELLED' : 'FAILED', error: signal.aborted ? null : 'OUTPUT_FAILED', pages: null } })
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
      try { return await files.read(file.relativePath) } catch {
        backend.generation.recordOutputState({ id, output: { status: 'FAILED', error: 'OUTPUT_MISSING', pages: null } })
        throw new OutputFailure('OUTPUT_MISSING')
      }
    }
  }
}
