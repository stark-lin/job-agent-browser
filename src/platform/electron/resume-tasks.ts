import { randomUUID } from 'node:crypto'
import { resumeFailures } from '../../shared/agent/resume-policy'
import { ToolError } from '../../shared/tools/errors'
import { AgentError, type StreamingAgentModel } from '../../shared/agent'
import { DataError, fail } from '../../domain/common/errors'
import * as v from '../../domain/common/validation'
import { isGenerating } from '../../domain/resume/state-machine'
import type { ResumeEvent, ResumeTask, ResumeTrace } from './resume-contract'
import type { AISettings } from '../../shared/ai'
import type { composeBackend } from '../database/backend'
import { createAgentEngine, type AgentEngine } from '../agent/engine'
import { resolveAskCapabilities } from '../ai/ask-capabilities'
import { createAgentRecorder, finishAgentRecord } from './agent-recorder'
import { compatibleAgentModel } from '../ai/agent-model'
import { requestConfig } from '../ai/transport'
import { createResumeOutput } from '../resume-output/service'
import { OutputFailure } from '../resume-output/files'
import { exportDocument } from '../resume-output/exporter'
import type { FirstPartyRuntime, MCPAgentTools } from '../mcp/first-party-client'

interface Work {
  owner: number; runId: string; controller: AbortController; sequence: number
  tools: MCPAgentTools; done?: Promise<void>; emit: (event: ResumeEvent) => void
}
export function resumeError(error: unknown): string {
  if (error instanceof OutputFailure) return error.code
  if (error instanceof ToolError) return error.code === 'TOOL_AUDIT_UNAVAILABLE' ? 'AUDIT_UNAVAILABLE'
    : error.code === 'TOOL_TIMEOUT' ? 'AGENT_TIMEOUT' : error.code === 'TOOL_CANCELLED' ? 'AGENT_CANCELLED' : error.code
  return error instanceof DataError || error instanceof AgentError ? error.code : 'VALIDATION_FAILED'
}
/** Main owns windows and UI projection; Agent capabilities always use its MCP session. */
export function createResumeTasks(deps: {
  backend: ReturnType<typeof composeBackend>; mcp: FirstPartyRuntime; settings(): AISettings; key(id: string): string | null
  directory: string; fonts: string; engine?: AgentEngine; model?(choice: { providerId: string; modelId: string }): StreamingAgentModel
}) {
  const { backend } = deps, active = new Map<number, Work>(), latest = new Map<number, string>()
  const sequences = new Map<string, number>(), pending = new Map<number, { controller: AbortController; done: Promise<void> }>()
  // This instance serves existing output files to UI. Builds only run inside the MCP Server.
  const outputs = createResumeOutput(backend, deps.directory, deps.fonts, exportDocument)
  const engine = deps.engine ?? createAgentEngine()
  let disposed = false
  const run = backend.generationRun
  const artifact = (id: string) => backend.resumes.getArtifact({ id }).artifact
  function task(work: Work): ResumeTask {
    return { run: run(work.runId), artifact: backend.artifactForRun(work.runId),
      active: active.get(work.owner) === work, owned: true, sequence: work.sequence }
  }
  function event(work: Work, settled = false) {
    work.sequence++; sequences.set(work.runId, work.sequence)
    const current = task(work)
    try { work.emit({ runId: work.runId, sequence: work.sequence, settled, state: current.run.state, artifactId: current.artifact?.id ?? null }) }
    catch { work.controller.abort() }
  }
  async function settle(tools: MCPAgentTools, runId: string, cancelled: boolean, error?: unknown) {
    const code = typeof error === 'string' ? error : resumeError(error)
    await tools.call(cancelled ? 'resume.cancel' : 'resume.fail', { runId,
      ...(cancelled ? {} : { error: resumeFailures.includes(code) ? code : 'VALIDATION_FAILED' }) }, AbortSignal.timeout(10000))
  }
  async function output(work: Work, artifactId: string) {
    event(work)
    try { await work.tools.call('artifact.build', { artifactId }, AbortSignal.any([work.controller.signal, work.tools.signal])) }
    finally {
      if (work.controller.signal.aborted && !work.tools.signal.aborted) {
        const until = Date.now() + 2000
        while (backend.lease.active('output', artifactId) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
  }
  function launch(work: Work, operation: () => Promise<void>) {
    active.set(work.owner, work); latest.set(work.owner, work.runId)
    work.done = new Promise(resolve => setImmediate(() => {
      void operation().catch(error => settle(work.tools, work.runId, work.controller.signal.aborted, error)).catch(async () => {
        // A disconnected owner cannot mutate through another session. Lease recovery owns interruption.
        await work.tools.close().catch(() => {})
      }).finally(async () => {
        await work.tools.close().catch(() => {})
        active.delete(work.owner); work.controller.abort()
        try {
          if (isGenerating(run(work.runId).state) && !backend.lease.active('generation', work.runId)) backend.recover()
          event(work, true)
        } catch { /* UI projection can outlive storage during shutdown. */ } finally { resolve() }
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
        const model = deps.model?.(settings.default!) ?? compatibleAgentModel(config, { audit: backend.recordAgentModel })
        tools = await deps.mcp.session('resume', controller.signal, requestId)
        const signal = AbortSignal.any([controller.signal, tools.signal])
        startInput = { ...args, requestId, model: { providerId: settings.default!.providerId, modelId: config.model } }
        signal.throwIfAborted(); dispatched = true
        id = (await tools.call('resume.start', startInput, signal) as { runId: string }).runId
        if (disposed) controller.abort()
        signal.throwIfAborted()
        const session = tools, work: Work = { owner, runId: id, tools: session, controller, sequence: 0, emit }
        const choice = startInput.model
        launch(work, async () => {
          event(work)
          signal.throwIfAborted()
          let agentRunId: string
          try {
            ({ agentRunId } = await session.call('resume.attach_agent', {
              runId: work.runId, requestId, ownerRuntimeId: backend.lease.id
            }, AbortSignal.timeout(10000)) as { agentRunId: string })
          } catch (error) {
            const id = run(work.runId).agentRunId
            if (id) {
              const recorder = createAgentRecorder(backend.chats, backend.chats.agentSnapshot(id), () => {}, () => {})
              await finishAgentRecord(recorder.finish, { state: 'interrupted', error: 'AGENT_INTERRUPTED', finalText: '' }, resumeError, () => disposed)
            }
            throw error
          }
          const snapshot = backend.chats.agentSnapshot(agentRunId)
          let recorderFailure: unknown
          const recorder = createAgentRecorder(backend.chats, snapshot, () => {}, error => { recorderFailure = error; controller.abort() })
          const handle = engine.start({
            invocation: { agent: 'resume', source: 'resume-generate', generationRunId: work.runId },
            requestId, model: choice, signal: controller.signal, onEvent: recorder.receive
          }, {
            runId: agentRunId, model: () => model,
            capabilities: (selected, live) => resolveAskCapabilities(settings, selected, deps.key(selected.providerId), live),
            open: live => deps.mcp.openAgentRun({ agent: 'resume', agentRunId, sessionId: requestId, generationRunId: work.runId, signal: live }),
            started: recorder.started, status: recorder.status, failure: () => recorderFailure, error: resumeError,
            finish: outcome => finishAgentRecord(recorder.finish, outcome, resumeError, () => disposed)
          })
          const outcome = await handle.completion
          if (outcome.state === 'interrupted') {
            await session.close()
            return
          }
          if (outcome.state !== 'completed') {
            await settle(session, work.runId, outcome.state === 'cancelled', outcome.error)
            return
          }
          signal.throwIfAborted()
          await session.call('resume.validate', { runId: work.runId }, signal)
          event(work)
          const { artifact } = await session.call('resume.publish', { runId: work.runId }, signal) as { artifact: { id: string } }
          await output(work, artifact.id)
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
        await tools?.close().catch(() => {})
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
      const external = isGenerating(current.state) && backend.lease.active('generation', id) || Boolean(saved && backend.lease.active('output', saved.id))
      return { run: current, artifact: saved, active: external, owned: false, sequence: sequences.get(id) ?? 0 }
    },
    getTrace(owner: number, input: unknown): ResumeTrace | null {
      const { runId } = v.object({ runId: v.id })(input)
      owned(owner, runId)
      const id = run(runId).agentRunId
      return id ? { ...(engine.getRun(id) ?? backend.chats.agentSnapshot(id)), cycles: backend.chats.agentCycles(id),
        requests: backend.chats.listModelRequests(id, 64, 0).items } : null
    },
    async cancel(owner: number, input: unknown) {
      const { runId } = v.object({ runId: v.id })(input), work = owned(owner, runId)
      if (!work) fail('FORBIDDEN')
      const id = run(runId).agentRunId
      if (id) engine.cancel(id)
      work.controller.abort()
      await work.done
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
        const tools = await deps.mcp.session('resume', controller.signal, randomUUID())
        controller.signal.throwIfAborted()
        const work: Work = { owner, runId: current.generationRunId, tools, controller, sequence: sequences.get(current.generationRunId) ?? 0, emit }
        launch(work, () => output(work, artifactId))
        return null
      } finally { pending.delete(owner); finish() }
    },
    async getPreview(input: unknown) {
      const { artifactId } = v.object({ artifactId: v.id })(input)
      const { bytes, pages, revision } = await outputs.read(artifactId, 'HTML')
      return { html: bytes.toString('utf8'), pages, revision }
    },
    async pdf(input: unknown) {
      const { artifactId } = v.object({ artifactId: v.id })(input)
      return { bytes: (await outputs.read(artifactId, 'PDF')).bytes, name: `${artifactId}.pdf` }
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
