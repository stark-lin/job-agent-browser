import { ToolError } from '../../shared/tools/errors'
import { abortable, AgentError } from '../../shared/agent'
import { DataError, fail } from '../../domain/common/errors'
import * as v from '../../domain/common/validation'
import type { GenerationStage } from '../../domain/resume/resume.types'
import type { ResumeEvent, ResumeTask } from '../electron/resume-contract'
import type { AISettings } from '../../shared/ai'
import type { composeBackend } from '../database/backend'
import { compatibleAgentModel } from './compatible'
import { requestConfig } from '../ai/transport'
import { runAgent } from './loop'
import { snapshotTools } from './snapshot-tools'
import { runResumeAgent } from '../../domain/resume/resume.agent'
import { artifactFiles, OutputFailure } from '../resume-output/files'
import { exportDocument } from '../resume-output/exporter'

interface Work { owner: number; runId: string; controller: AbortController; sequence: number; stage: GenerationStage; done?: Promise<void>; emit: (event: ResumeEvent) => void }
export function resumeError(error: unknown): string {
  if (error instanceof OutputFailure) return error.code
  if (error instanceof ToolError && error.code === 'TOOL_AUDIT_UNAVAILABLE') return 'AUDIT_UNAVAILABLE'
  return error instanceof DataError || error instanceof AgentError ? error.code : 'VALIDATION_FAILED'
}
/** Window-owned execution; persisted run/artifact remain queryable after navigation or restart. */
export function createResumeTasks(deps: {
  backend: ReturnType<typeof composeBackend>; settings(): AISettings; key(id: string): string | null
  directory: string; fonts: string
  render?: typeof exportDocument
}) {
  const { backend } = deps, files = artifactFiles(deps.directory), active = new Map<number, Work>(), latest = new Map<number, string>()
  const sequences = new Map<string, number>()
  let disposed = false
  const run = (id: string) => backend.resumes.getRun({ id }).run
  const artifact = (id: string) => backend.resumes.getArtifact({ id }).artifact
  // Published artifacts have a unique run ID; historical lookup avoids any mutable Profile reads.
  function forRun(id: string) { return backend.artifactForRun(id) }
  function task(work: Work): ResumeTask { return { run: { ...run(work.runId), stage: work.stage }, artifact: forRun(work.runId), active: active.get(work.owner) === work, sequence: work.sequence } }
  function event(work: Work, stage: GenerationStage) {
    work.stage = stage; work.sequence++; sequences.set(work.runId, work.sequence)
    const current = task(work)
    try { work.emit({ runId: work.runId, sequence: work.sequence, stage, status: current.run.status, artifactId: current.artifact?.id ?? null }) } catch { work.controller.abort() }
  }
  async function output(work: Work, artifactId: string) {
    const signal = work.controller.signal
    try {
      signal.throwIfAborted()
      backend.generation.recordOutputState({ id: artifactId, output: { status: 'RUNNING', error: null, pages: null } })
      event(work, 'output')
      const content = artifact(artifactId).content, version = JSON.stringify(content)
      const result = await abortable((deps.render ?? exportDocument)(content, deps.fonts, signal), signal)
      if (JSON.stringify(artifact(artifactId).content) !== version) fail('CONFLICT')
      signal.throwIfAborted()
      const written = await files.write(artifactId, result, signal)
      signal.throwIfAborted()
      if (JSON.stringify(artifact(artifactId).content) !== version) fail('CONFLICT')
      backend.generation.recordOutputFiles({ id: artifactId, files: written })
      backend.generation.recordOutputState({ id: artifactId, output: { status: 'READY', error: null, pages: result.pages } })
    } catch {
      backend.generation.recordOutputState({ id: artifactId, output: { status: signal.aborted ? 'CANCELLED' : 'FAILED', error: signal.aborted ? null : 'OUTPUT_FAILED', pages: null } })
    }
  }
  async function readOutput(artifactId: string, format: 'HTML' | 'PDF') {
    const current = artifact(artifactId), file = current.outputFiles.find(file => file.format === format)
    if (!file || current.output.status !== 'READY') fail('INVALID_STATE')
    try { return await files.read(file.relativePath) }
    catch {
      backend.generation.recordOutputState({ id: artifactId, output: { status: 'FAILED', error: 'OUTPUT_MISSING', pages: null } })
      throw new OutputFailure('OUTPUT_MISSING')
    }
  }
  function launch(work: Work, operation: () => Promise<void>) {
    active.set(work.owner, work); latest.set(work.owner, work.runId)
    work.done = new Promise(resolve => setImmediate(() => {
      void operation().catch(error => {
        const current = run(work.runId)
        if (['PENDING', 'RUNNING'].includes(current.status)) {
          if (work.controller.signal.aborted) backend.resumes.cancelRun({ id: work.runId })
          else {
            const code = resumeError(error)
            backend.generation.failRun({ id: work.runId, error: ['AGENT_PROTOCOL_ERROR', 'AGENT_STEP_LIMIT', 'AGENT_TIMEOUT', 'AI_AUTH_FAILED', 'AI_RATE_LIMITED', 'AI_PROVIDER_FAILED', 'AI_CONNECT_FAILED', 'AUDIT_UNAVAILABLE'].includes(code) ? code : 'VALIDATION_FAILED' })
          }
        }
      }).catch(() => {}).finally(() => {
        active.delete(work.owner); work.controller.abort(); try { event(work, 'completed') } catch { /* Storage may be unavailable; persisted recovery owns the next startup. */ } finally { resolve() }
      })
    }))
  }
  function available(owner: number) { if (disposed || active.has(owner)) fail('INVALID_STATE') }
  function owned(owner: number, id: string) {
    const running = [...active.values()].find(work => work.runId === id)
    if (running && running.owner !== owner) fail('FORBIDDEN')
    return running
  }
  return {
    start(owner: number, input: unknown, emit: Work['emit']) {
      available(owner)
      const args = v.object({ jobId: v.id, profileId: v.id })(input), settings = deps.settings()
      const config = requestConfig(settings, deps.key, settings.default)
      const model = compatibleAgentModel(config, { audit: backend.recordAgentModel })
      const current = backend.resumes.createRun({ ...args, config: { providerId: settings.default!.providerId, modelId: config.model } })
      const work: Work = { owner, runId: current.id, controller: new AbortController(), sequence: 0, stage: 'snapshot', emit }
      launch(work, async () => {
        const tools = snapshotTools(current.inputSnapshot, backend.capabilities, current.id, work.controller.signal)
        try {
          const published = await runResumeAgent(current, { generation: backend.generation, signal: work.controller.signal, stage: stage => event(work, stage),
            runner: (_stage, instruction) => runAgent(model, tools.scope, [{ role: 'user', content: instruction }], work.controller.signal) })
          if (published) await output(work, published.id)
        } finally { tools.dispose() }
      })
      return { runId: current.id }
    },
    getTask(owner: number, input: unknown): ResumeTask | null {
      const args = v.object({ runId: v.optionalId })(input), id = args.runId ?? latest.get(owner) ?? backend.resumes.listRuns({ limit: 100 }).items.find(({ run }) => ![...active.values()].some(work => work.runId === run.id && work.owner !== owner))?.run.id
      if (!id) return null
      const work = owned(owner, id)
      if (work) return task(work)
      let saved = forRun(id)
      if (saved?.output.status === 'RUNNING') saved = backend.generation.recordOutputState({ id: saved.id, output: { status: 'FAILED', error: 'OUTPUT_INTERRUPTED', pages: null } })
      return { run: run(id), artifact: saved, active: false, sequence: sequences.get(id) ?? 0 }
    },
    cancel(owner: number, input: unknown) {
      const { runId } = v.object({ runId: v.id })(input), work = owned(owner, runId)
      if (work) {
        work.controller.abort()
        if (['PENDING', 'RUNNING'].includes(run(runId).status)) backend.resumes.cancelRun({ id: runId })
      }
      return null
    },
    retryOutput(owner: number, input: unknown, emit: Work['emit']) {
      available(owner)
      const { artifactId } = v.object({ artifactId: v.id })(input), current = artifact(artifactId)
      owned(owner, current.generationRunId)
      const work: Work = { owner, runId: current.generationRunId, controller: new AbortController(), sequence: sequences.get(current.generationRunId) ?? 0, stage: 'output', emit }
      launch(work, () => output(work, artifactId))
      return null
    },
    async getPreview(input: unknown) {
      const { artifactId } = v.object({ artifactId: v.id })(input), current = artifact(artifactId)
      return { html: (await readOutput(artifactId, 'HTML')).toString('utf8'), pages: current.output.pages! }
    },
    async pdf(input: unknown) {
      const { artifactId } = v.object({ artifactId: v.id })(input)
      return { bytes: await readOutput(artifactId, 'PDF'), name: `${artifactId}.pdf` }
    },
    disposeOwner(owner: number) { const work = active.get(owner); if (work) { work.controller.abort(); if (['PENDING', 'RUNNING'].includes(run(work.runId).status)) backend.resumes.cancelRun({ id: work.runId }) } },
    async dispose() { disposed = true; for (const work of active.values()) work.controller.abort(); await Promise.all([...active.values()].map(work => work.done)) }
  }
}
export type ResumeTasks = ReturnType<typeof createResumeTasks>
