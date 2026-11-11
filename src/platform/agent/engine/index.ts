import type { AgentSnapshot } from '../../../domain/chat/chat.types'
import { abortable, isAgentCancellation, type AgentRuntimeEvent, type AgentTools, type StreamingAgentModel } from '../../../shared/agent'
import type { AskRuntimeStatus } from '../../../shared/ask'
import { ToolError } from '../../../shared/tools/errors'
import type { ModelCapabilities } from '../../../shared/ai'
import { ContextBudget } from '../context/budget'
import { createRunExecution, type RunHistory } from './execution-context'
import { runAskWorkflow } from './ask-workflow'
import { definitions, type AgentInvocation } from './definitions'

export interface AgentCompletion {
  state: 'completed' | 'failed' | 'cancelled' | 'interrupted'
  finalText: string
  error: string | null
}
export interface AgentHandle { runId: string; completion: Promise<AgentCompletion>; cancel(): void }

type Choice = { providerId: string; modelId: string }
interface Start {
  invocation: AgentInvocation; requestId: string; model: Choice; signal: AbortSignal
  onEvent?(event: AgentRuntimeEvent): void
}
interface Execution {
  runId: string
  prior?: Promise<unknown>
  capabilities(choice: Choice, signal: AbortSignal): Promise<ModelCapabilities>
  model(choice: Choice): StreamingAgentModel
  open(signal: AbortSignal): Promise<{ tools: AgentTools; signal: AbortSignal; close(): Promise<void> }>
  history?(): RunHistory
  protect?(record: string): void
  started(): void
  status(value: AskRuntimeStatus): void
  finish(outcome: AgentCompletion): AgentCompletion | void | Promise<AgentCompletion | void>
  error(error: unknown): string
  failure?(): unknown
  onToolTurn?(): void
}

export function createAgentEngine(readRun?: (id: string) => AgentSnapshot) {
  const active = new Map<string, AgentHandle>()
  const requests = new Map<string, { key: string; handle: AgentHandle }>()
  return {
    start(input: Start, execution: Execution): AgentHandle {
      const { invocation } = input, definition = definitions[invocation.agent]
      const key = JSON.stringify([invocation, input.model])
      const previous = requests.get(input.requestId)
      if (previous) {
        if (previous.key !== key || previous.handle.runId !== execution.runId) throw new Error('AGENT_REQUEST_CONFLICT')
        return previous.handle
      }
      if (active.has(execution.runId)) throw new Error('AGENT_RUN_CONFLICT')
      const controller = new AbortController(), signal = AbortSignal.any([controller.signal, input.signal])
      const emit = input.onEvent ?? (() => {})
      const completion = new Promise<void>(resolve => setImmediate(resolve)).then(async (): Promise<AgentCompletion> => {
        let session: Awaited<ReturnType<Execution['open']>> | undefined
        let outcome: AgentCompletion = { state: 'completed', finalText: '', error: null }
        try {
          execution.started(); execution.status('pending')
          if (execution.prior) await abortable(execution.prior, signal)
          signal.throwIfAborted()
          const budget = new ContextBudget(await execution.capabilities(input.model, signal), input.model.modelId)
          signal.throwIfAborted()
          const model = execution.model(input.model)
          session = await execution.open(signal)
          const live = AbortSignal.any([signal, session.signal]), { tools } = session
          const history = invocation.agent === 'ask' ? execution.history?.() : undefined
          const run = createRunExecution({ model, budget, signal: live, userSignal: signal, emit,
            ...definition.limits, protectedState: history?.protectedState ?? [], status: execution.status,
            protect: execution.protect, onToolTurn: execution.onToolTurn })
          outcome.finalText = invocation.agent === 'ask'
            ? await runAskWorkflow({ run, invocation, tools, allow: definitions.ask.tools.allow, signal: live, history, emit, status: execution.status })
            : await run.stage({ phase: 'execute', tools, system: definitions.resume.system, status: 'idle', allow: definitions.resume.tools.allow,
              memory: await run.loadCore(tools),
              message: `Tailor the resume for generation run ${invocation.generationRunId}. Use this runId for resume tools.` })
          live.throwIfAborted()
          await session.close()
          signal.throwIfAborted()
        } catch (error) {
          const disconnected = session?.signal.aborted && !signal.aborted
          let cleanupFailure: unknown
          try { await session?.close() } catch (failure) { cleanupFailure = failure }
          const cancelled = isAgentCancellation(error, signal) || signal.aborted && error instanceof ToolError && error.code === 'TOOL_CANCELLED'
          const fatal = execution.failure?.() ?? (cancelled ? cleanupFailure : error)
          outcome = cancelled && fatal === undefined ? { state: 'cancelled', error: null, finalText: '' }
            : invocation.agent === 'resume' && disconnected
              ? { state: 'interrupted', error: 'AGENT_INTERRUPTED', finalText: '' }
              : { state: 'failed', error: execution.error(fatal), finalText: '' }
        }
        return await execution.finish(outcome) ?? outcome
      }).finally(() => {
        active.delete(execution.runId); requests.delete(input.requestId); controller.abort()
      })
      const handle = { runId: execution.runId, completion, cancel: () => controller.abort() }
      active.set(handle.runId, handle)
      requests.set(input.requestId, { key, handle })
      return handle
    },
    getRun(runId: string) { return readRun?.(runId) },
    cancel(runId: string) { active.get(runId)?.cancel() }
  }
}
export type AgentEngine = ReturnType<typeof createAgentEngine>
