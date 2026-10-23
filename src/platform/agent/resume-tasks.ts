import { randomUUID } from 'node:crypto'
import { ToolError } from '../../shared/tools/errors'
import { AgentError } from '../../shared/agent'
import { DataError, fail } from '../../domain/common/errors'
import * as v from '../../domain/common/validation'
import type { GenerationStage } from '../../domain/resume/resume.types'
import type { ResumeEvent, ResumeTask } from '../electron/resume-contract'
import type { AISettings } from '../../shared/ai'
import type { composeBackend } from '../database/backend'
import { compatibleAgentModel } from './compatible'
import { requestConfig } from '../ai/transport'
import { runAgent } from './loop'
import { createResumeTooling } from '../tools/resume'
import { resumeReadTools, resumeSubmitTools } from '../../domain/resume/workflow'
import { createResumeOutput } from '../resume-output/service'
import { runResumeAgent } from '../../domain/resume/resume.agent'
import { OutputFailure } from '../resume-output/files'
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
  const { backend } = deps, active = new Map<number, Work>(), latest = new Map<number, string>()
  const sequences = new Map<string, number>()
  const pending = new Map<number, { controller: AbortController; done: Promise<void> }>()
  const outputs = createResumeOutput(backend, deps.directory, deps.fonts, deps.render ?? exportDocument)
  const tooling = createResumeTooling(backend, (id, signal) => outputs.build(id, signal))
  async function cancelRun(id: string) {
    const scope = tooling.registry.scope({ allow: ['resume.cancel'], maxRisk: 'WRITE' }, { agentId: 'resume-controller', runId: id, signal: new AbortController().signal })
    try { await scope.execute('resume.cancel', { runId: id }) } finally { scope.dispose() }
  }
  let disposed = false
  const run = (id: string) => backend.resumes.getRun({ id }).run
  const artifact = (id: string) => backend.resumes.getArtifact({ id }).artifact
  // Published artifacts have a unique run ID; historical lookup avoids any mutable Profile reads.
  function forRun(id: string) { return backend.artifactForRun(id) }
  function task(work: Work): ResumeTask { return { run: { ...run(work.runId), stage: work.stage }, artifact: forRun(work.runId), active: active.get(work.owner) === work, owned: true, sequence: work.sequence } }
  function event(work: Work, stage: GenerationStage) {
    work.stage = stage; work.sequence++; sequences.set(work.runId, work.sequence)
    const current = task(work)
    try { work.emit({ runId: work.runId, sequence: work.sequence, stage, status: current.run.status, artifactId: current.artifact?.id ?? null }) } catch { work.controller.abort() }
  }
  async function output(work: Work, artifactId: string) {
    const current = createResumeTooling(backend, (id, signal) => outputs.build(id, signal, () => event(work, 'output')))
    const scope = current.registry.scope({ allow: ['artifact.build'], maxRisk: 'WRITE' }, { agentId: 'resume-controller', runId: work.runId, signal: work.controller.signal })
    try { await scope.execute('artifact.build', { artifactId }) } finally { scope.dispose(); current.dispose() }
  }
  function launch(work: Work, operation: () => Promise<void>) {
    active.set(work.owner, work); latest.set(work.owner, work.runId)
    work.done = new Promise(resolve => setImmediate(() => {
      void operation().catch(async error => {
        const current = run(work.runId)
        if (['PENDING', 'RUNNING'].includes(current.status)) {
          if (work.controller.signal.aborted) await cancelRun(work.runId)
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
  function available(owner: number) { if (disposed || active.has(owner) || pending.has(owner)) fail('INVALID_STATE') }
  function owned(owner: number, id: string) {
    const running = [...active.values()].find(work => work.runId === id)
    if (running && running.owner !== owner) fail('FORBIDDEN')
    return running
  }
  return {
    async start(owner: number, input: unknown, emit: Work['emit']) {
      available(owner)
      const controller = new AbortController()
      const requestId = randomUUID()
      let finish!: () => void
      const done = new Promise<void>(resolve => { finish = resolve })
      pending.set(owner, { controller, done })
      let currentTools: ReturnType<typeof createResumeTooling> | undefined
      try {
        const args = v.object({ jobId: v.id, profileId: v.id })(input), settings = deps.settings()
        const config = requestConfig(settings, deps.key, settings.default)
        const model = compatibleAgentModel(config, { audit: backend.recordAgentModel })
        const tools = currentTools = createResumeTooling(backend, (id, signal) => outputs.build(id, signal), { providerId: settings.default!.providerId, modelId: config.model })
        const startScope = tools.registry.scope({ allow: ['resume.start'], maxRisk: 'WRITE' }, { agentId: 'resume-controller', signal: controller.signal })
        let id: string
        try { id = ((await startScope.execute('resume.start', { ...args, requestId })).structuredContent as { runId: string }).runId } finally { startScope.dispose() }
        if (disposed || controller.signal.aborted) { await cancelRun(id); controller.signal.throwIfAborted(); fail('INVALID_STATE') }
        const current = run(id)
        const work: Work = { owner, runId: current.id, controller, sequence: 0, stage: 'snapshot', emit }
        const read = tools.registry.scope({ allow: resumeReadTools, maxRisk: 'READ' }, { agentId: 'resume', runId: current.id, signal: controller.signal })
        const write = tools.registry.scope({ allow: [...resumeSubmitTools, 'resume.publish'], maxRisk: 'WRITE' }, { agentId: 'resume-controller', runId: current.id, signal: controller.signal })
        launch(work, async () => {
          try {
            const published = await runResumeAgent(current, { tools: write, signal: controller.signal, stage: stage => event(work, stage),
              runner: (_stage, instruction) => runAgent(model, read, [{ role: 'user', content: instruction }], controller.signal) })
            if (published) await output(work, published.id)
          } finally { read.dispose(); write.dispose(); tools.dispose() }
        })
        return { runId: current.id }
      } catch (error) {
        const cancelled = controller.signal.aborted
        controller.abort(); currentTools?.dispose()
        const created = backend.ownedStart(requestId)
        if (created && ['PENDING', 'RUNNING'].includes(created.status)) {
          if (cancelled) await cancelRun(created.id)
          else backend.generation.failRun({ id: created.id, error: resumeError(error) === 'AUDIT_UNAVAILABLE' ? 'AUDIT_UNAVAILABLE' : 'VALIDATION_FAILED' })
        }
        throw error
      }
      finally { pending.delete(owner); finish() }
    },
    getTask(owner: number, input: unknown): ResumeTask | null {
      const args = v.object({ runId: v.optionalId })(input), id = args.runId ?? latest.get(owner) ?? backend.resumes.listRuns({ limit: 100 }).items.find(({ run }) => ![...active.values()].some(work => work.runId === run.id && work.owner !== owner))?.run.id
      if (!id) return null
      const work = owned(owner, id)
      if (work) return task(work)
      const saved = forRun(id), current = run(id)
      const external = ['PENDING', 'RUNNING'].includes(current.status) && backend.lease.active('generation', id) || Boolean(saved && backend.lease.active('output', saved.id))
      return { run: current, artifact: saved, active: external, owned: false, sequence: sequences.get(id) ?? 0 }
    },
    async cancel(owner: number, input: unknown) {
      const { runId } = v.object({ runId: v.id })(input), work = owned(owner, runId)
      if (!work) fail('FORBIDDEN')
      work.controller.abort()
      if (['PENDING', 'RUNNING'].includes(run(runId).status)) await cancelRun(runId)
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
      return { html: (await outputs.read(artifactId, 'HTML')).toString('utf8'), pages: current.output.pages! }
    },
    async pdf(input: unknown) {
      const { artifactId } = v.object({ artifactId: v.id })(input)
      return { bytes: await outputs.read(artifactId, 'PDF'), name: `${artifactId}.pdf` }
    },
    disposeOwner(owner: number) { pending.get(owner)?.controller.abort(); const work = active.get(owner); if (work) work.controller.abort() },
    async dispose() {
      disposed = true
      for (const start of pending.values()) start.controller.abort()
      for (const work of active.values()) work.controller.abort()
      await Promise.all([...pending.values()].map(start => start.done))
      await Promise.all([...active.values()].map(work => work.done)); await outputs.settle(); tooling.dispose()
    }
  }
}
export type ResumeTasks = ReturnType<typeof createResumeTasks>
