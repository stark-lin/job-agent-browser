import { randomUUID } from 'node:crypto'
import { ToolError } from '../../shared/tools/errors'
import { AgentError } from '../../shared/agent'
import { DataError, fail } from '../../domain/common/errors'
import * as v from '../../domain/common/validation'
import type { GenerationStage } from '../../domain/resume/resume.types'
import type { ResumeEvent, ResumeTask } from './resume-contract'
import type { AISettings } from '../../shared/ai'
import type { composeBackend } from '../database/backend'
import { compatibleAgentModel } from '../ai/agent-model'
import { requestConfig } from '../ai/transport'
import { runAgent } from '../agent/loop'
import { resumeReadTools } from '../../domain/resume/workflow'
import { createResumeOutput } from '../resume-output/service'
import { runResumeAgent } from '../agent/resume'
import { OutputFailure } from '../resume-output/files'
import { exportDocument } from '../resume-output/exporter'
import type { FirstPartyRuntime, MCPAgentTools } from '../mcp/first-party-client'

interface Work {
  owner: number; runId: string; controller: AbortController; sequence: number; stage: GenerationStage
  tools: MCPAgentTools; done?: Promise<void>; emit: (event: ResumeEvent) => void
}
export function resumeError(error: unknown): string {
  if (error instanceof OutputFailure) return error.code
  if (error instanceof ToolError) return error.code === 'TOOL_AUDIT_UNAVAILABLE' ? 'AUDIT_UNAVAILABLE'
    : error.code === 'TOOL_TIMEOUT' ? 'AGENT_TIMEOUT' : error.code === 'TOOL_CANCELLED' ? 'AGENT_CANCELLED' : error.code
  return error instanceof DataError || error instanceof AgentError ? error.code : 'VALIDATION_FAILED'
}
const failures = ['AGENT_PROTOCOL_ERROR', 'AGENT_STEP_LIMIT', 'AGENT_TIMEOUT', 'AI_AUTH_FAILED', 'AI_RATE_LIMITED', 'AI_PROVIDER_FAILED', 'AI_CONNECT_FAILED', 'AUDIT_UNAVAILABLE']
/** Main owns windows and UI projection; Agent capabilities always use its MCP session. */
export function createResumeTasks(deps: {
  backend: ReturnType<typeof composeBackend>; mcp: FirstPartyRuntime; settings(): AISettings; key(id: string): string | null
  directory: string; fonts: string
}) {
  const { backend } = deps, active = new Map<number, Work>(), latest = new Map<number, string>()
  const sequences = new Map<string, number>(), pending = new Map<number, { controller: AbortController; done: Promise<void> }>()
  // This instance serves existing output files to UI. Builds only run inside the MCP Server.
  const outputs = createResumeOutput(backend, deps.directory, deps.fonts, exportDocument)
  let disposed = false
  const run = (id: string) => backend.resumes.getRun({ id }).run
  const artifact = (id: string) => backend.resumes.getArtifact({ id }).artifact
  function task(work: Work): ResumeTask {
    return { run: { ...run(work.runId), stage: work.stage }, artifact: backend.artifactForRun(work.runId),
      active: active.get(work.owner) === work, owned: true, sequence: work.sequence }
  }
  function event(work: Work, stage: GenerationStage) {
    work.stage = stage; work.sequence++; sequences.set(work.runId, work.sequence)
    const current = task(work)
    try { work.emit({ runId: work.runId, sequence: work.sequence, stage, status: current.run.status, artifactId: current.artifact?.id ?? null }) }
    catch { work.controller.abort() }
  }
  async function settle(tools: MCPAgentTools, runId: string, cancelled: boolean, error?: unknown) {
    const code = resumeError(error)
    await tools.call(cancelled ? 'resume.cancel' : 'resume.fail', { runId,
      ...(cancelled ? {} : { error: failures.includes(code) ? code : 'VALIDATION_FAILED' }) }, AbortSignal.timeout(10000))
  }
  async function output(work: Work, artifactId: string) {
    event(work, 'output')
    await work.tools.call('artifact.build', { artifactId }, AbortSignal.any([work.controller.signal, work.tools.signal]))
  }
  function launch(work: Work, operation: () => Promise<void>) {
    active.set(work.owner, work); latest.set(work.owner, work.runId)
    work.done = new Promise(resolve => setImmediate(() => {
      void operation().catch(error => settle(work.tools, work.runId, work.controller.signal.aborted, error)).catch(async () => {
        // A disconnected owner cannot mutate through another session. Lease recovery owns interruption.
        await work.tools.close()
      }).finally(() => {
        active.delete(work.owner); work.controller.abort()
        try { event(work, 'completed') } catch { /* UI projection can outlive storage during shutdown. */ } finally { resolve() }
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
      const controller = new AbortController(), requestId = randomUUID()
      let finish!: () => void
      const done = new Promise<void>(resolve => { finish = resolve })
      pending.set(owner, { controller, done })
      let tools: MCPAgentTools | undefined, id: string | undefined
      let startInput: { jobId: string; profileId: string; requestId: string; model: { providerId: string; modelId: string } } | undefined
      let dispatched = false
      try {
        const args = v.object({ jobId: v.id, profileId: v.id })(input), settings = deps.settings()
        const config = requestConfig(settings, deps.key, settings.default)
        const model = compatibleAgentModel(config, { audit: backend.recordAgentModel })
        tools = await deps.mcp.session('resume', controller.signal)
        const signal = AbortSignal.any([controller.signal, tools.signal])
        startInput = { ...args, requestId, model: { providerId: settings.default!.providerId, modelId: config.model } }
        signal.throwIfAborted(); dispatched = true
        id = (await tools.call('resume.start', startInput, signal) as { runId: string }).runId
        if (disposed) controller.abort()
        signal.throwIfAborted()
        const context = await tools.call('resume.get_context', { runId: id }, signal) as { config: { targetWordCount: number } }
        const session = tools, work: Work = { owner, runId: id, tools: session, controller, sequence: 0, stage: 'snapshot', emit }
        const read = session.view(resumeReadTools, { runId: id })
        launch(work, async () => {
          const published = await runResumeAgent({ id: work.runId, config: context.config }, { tools: session, signal,
            stage: stage => event(work, stage), runner: (_stage, instruction) => runAgent(model, read, [{ role: 'user', content: instruction }], signal) })
          if (published) await output(work, published.id)
        })
        return { runId: id }
      } catch (error) {
        const cancelled = controller.signal.aborted
        controller.abort()
        if (tools && dispatched && startInput) {
          try {
            // An uncertain start is retried only in the original live session using its receipt.
            id ??= (await tools.call('resume.start', startInput, AbortSignal.timeout(10000)) as { runId: string }).runId
            await settle(tools, id, cancelled, error)
          } catch { await tools.close() /* Retire the owner so recovery can interrupt an uncertain start. */ }
        }
        throw error
      } finally { pending.delete(owner); finish() }
    },
    getTask(owner: number, input: unknown): ResumeTask | null {
      const args = v.object({ runId: v.optionalId })(input)
      const id = args.runId ?? latest.get(owner) ?? backend.resumes.listRuns({ limit: 100 }).items.find(({ run }) => ![...active.values()].some(work => work.runId === run.id && work.owner !== owner))?.run.id
      if (!id) return null
      const work = owned(owner, id)
      if (work) return task(work)
      const saved = backend.artifactForRun(id), current = run(id)
      const external = ['PENDING', 'RUNNING'].includes(current.status) && backend.lease.active('generation', id) || Boolean(saved && backend.lease.active('output', saved.id))
      return { run: current, artifact: saved, active: external, owned: false, sequence: sequences.get(id) ?? 0 }
    },
    async cancel(owner: number, input: unknown) {
      const { runId } = v.object({ runId: v.id })(input), work = owned(owner, runId)
      if (!work) fail('FORBIDDEN')
      work.controller.abort()
      await settle(work.tools, runId, true)
      return null
    },
    async retryOutput(owner: number, input: unknown, emit: Work['emit']) {
      available(owner)
      const { artifactId } = v.object({ artifactId: v.id })(input), current = artifact(artifactId)
      owned(owner, current.generationRunId)
      const controller = new AbortController()
      let finish!: () => void
      const done = new Promise<void>(resolve => { finish = resolve })
      pending.set(owner, { controller, done })
      try {
        const tools = await deps.mcp.session('resume', controller.signal)
        controller.signal.throwIfAborted()
        const work: Work = { owner, runId: current.generationRunId, tools, controller, sequence: sequences.get(current.generationRunId) ?? 0, stage: 'output', emit }
        launch(work, () => output(work, artifactId))
        return null
      } finally { pending.delete(owner); finish() }
    },
    async getPreview(input: unknown) {
      const { artifactId } = v.object({ artifactId: v.id })(input), current = artifact(artifactId)
      return { html: (await outputs.read(artifactId, 'HTML')).toString('utf8'), pages: current.output.pages! }
    },
    async pdf(input: unknown) {
      const { artifactId } = v.object({ artifactId: v.id })(input)
      return { bytes: await outputs.read(artifactId, 'PDF'), name: `${artifactId}.pdf` }
    },
    disposeOwner(owner: number) { pending.get(owner)?.controller.abort(); active.get(owner)?.controller.abort() },
    async dispose() {
      disposed = true
      for (const start of pending.values()) start.controller.abort()
      for (const work of active.values()) work.controller.abort()
      await Promise.all([...pending.values()].map(start => start.done))
      await Promise.all([...active.values()].map(work => work.done)); await outputs.settle()
    }
  }
}
export type ResumeTasks = ReturnType<typeof createResumeTasks>
