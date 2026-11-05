import { AgentError, abortable, isAgentCancellation, type AgentRuntimeEvent, type StreamingAgentModel } from '../../shared/agent'
import type { ModelCapabilities } from '../../shared/ai'
import type { AskRuntimeStatus } from '../../shared/ask'
import type { ChatSnapshot, AgentRunEvent } from '../../domain/chat/chat.types'
import { chatStart } from '../../domain/chat/chat.validation'
import * as v from '../../domain/common/validation'
import { DataError, fail } from '../../domain/common/errors'
import type { ChatRecorder } from '../database/repositories/chats'
import type { FirstPartyRuntime } from '../mcp/first-party-client'
import { ToolError } from '../../shared/tools/errors'
import { askSystem, runAskAgent } from '../agent/ask'
import { discoveryTools } from '../agent/tools/discovery'
import { ContextBudget } from '../agent/context/budget'
import { ContextManager } from '../agent/context/manager'
import { loadCoreMemory } from '../agent/context/core-memory'
import { resourceRecord, updateResourceRecords } from '../agent/context/resources'
import { createAskRecorder } from './ask-agent-recorder'
import { observeAskModel } from '../agent/pi/request-observer'

export function askError(error: unknown): string {
  if (error instanceof DataError || error instanceof AgentError || error instanceof ToolError) return error.code
  return 'AI_PROVIDER_FAILED'
}
interface Task { owner: number; controller: AbortController; snapshot: ChatSnapshot; done?: Promise<void>; settled?: boolean; failure?: unknown; undurable?: boolean }
export function createAskAgentTasks(deps: { chats: ChatRecorder; mcp: FirstPartyRuntime;
  capabilities(choice: { providerId: string; modelId: string }, signal: AbortSignal): Promise<ModelCapabilities>;
  model(choice: { providerId: string; modelId: string }): StreamingAgentModel }) {
  const tasks = new Map<string, Task>(), tails = new Map<string, Promise<void>>()
  let disposed = false
  function owned(owner: number, input: unknown) {
    const { runId } = v.object({ runId: v.id })(input), task = tasks.get(runId)
    if (task && task.owner !== owner) fail('FORBIDDEN')
    return { runId, task }
  }
  return {
    start(owner: number, input: unknown, send: (event: AgentRunEvent) => void) {
      if (disposed) fail('INVALID_STATE')
      const args = chatStart(input)
      if (Buffer.byteLength(args.message.trim()) > 1048576) fail('INVALID_INPUT')
      const normalized = { ...args, sessionId: args.sessionId || undefined }, previous = deps.chats.lookup(normalized)
      if (previous) { owned(owner, { runId: previous.runId }); return previous }
      if ([...tasks.values()].filter(t => !t.settled).length >= 16
        || [...tasks.values()].filter(t => t.owner === owner && !t.settled).length >= 4) fail('INVALID_STATE')
      const result = deps.chats.start(normalized, true)
      const snapshot = deps.chats.snapshot(result.runId), controller = new AbortController()
      const task: Task = { owner, controller, snapshot }; tasks.set(result.runId, task)
      const recorder = createAskRecorder(deps.chats, snapshot, event => { try { send(event) } catch { /* Renderer loss has owner disposal. */ } }, error => { task.failure = error; controller.abort() })
      function receive(event: AgentRuntimeEvent) {
        try { recorder.receive(event) }
        catch (error) { task.failure ??= error; throw error }
      }
      function status(value: AskRuntimeStatus) {
        snapshot.run.runtimeStatus = value; snapshot.run.eventSequence++
        deps.chats.runtimeStatus(result.runId, value, snapshot.run.eventSequence)
        try { send({ type: 'runtime.status', status: value, run: structuredClone(snapshot.run), sessionId: result.sessionId, runId: result.runId, eventSequence: snapshot.run.eventSequence }) } catch { /* Renderer unavailable. */ }
      }
      const prior = tails.get(result.sessionId) ?? Promise.resolve()
      task.done = new Promise<void>(resolve => setImmediate(resolve)).then(async () => {
        let run: Awaited<ReturnType<FirstPartyRuntime['openAskRun']>> | undefined
        let state: 'completed' | 'cancelled' | 'failed' = 'completed', reason: string | null = null
        try {
          recorder.started(); status('pending')
          await abortable(prior, controller.signal); controller.signal.throwIfAborted()
          const budget = new ContextBudget(await deps.capabilities(args.choice, controller.signal), args.choice.modelId)
          controller.signal.throwIfAborted()
          const model = observeAskModel(deps.model(args.choice), receive)
          budget.assert([{ role: 'system', content: askSystem }, { role: 'user', content: args.message.trim() }], discoveryTools)
          const user = snapshot.items[0], sessionId = result.sessionId
          deps.chats.admit(result.runId); snapshot.run.admission = 'admitted'
          run = await deps.mcp.openAskRun({ chatRunId: result.runId, sessionId, sourceMessageIds: [user.id], signal: controller.signal })
          const tools = run.tools
          const signal = AbortSignal.any([controller.signal, tools.signal])
          const memory = await loadCoreMemory(tools, budget, signal)
          const context = new ContextManager({ budget, model, checkpoint: deps.chats.context(sessionId), turns: deps.chats.contextTurns(sessionId, user.sequence, args.choice),
            memory, protectedState: deps.chats.protectedState(sessionId),
            save: (value, revision) => deps.chats.saveContext(sessionId, value, revision), compacting: () => status('context.compacting') })
          status('idle')
          await runAskAgent({ model, tools, message: args.message.trim(), signal, userSignal: controller.signal, budget, context, emit: receive, status,
            protect(name, input, output, uncertain) {
              const record = resourceRecord(name, input, output, uncertain)
              if (record) { deps.chats.saveProtected(sessionId, updateResourceRecords(deps.chats.protectedState(sessionId), record)); context.protect(record) }
            } })
          signal.throwIfAborted()
          await run.close()
          controller.signal.throwIfAborted()
        } catch (error) {
          let cleanupFailure: unknown
          try { await run?.close() } catch (failure) { cleanupFailure = failure }
          const userCancelled = isAgentCancellation(error, controller.signal)
          const fatal = task.failure ?? (userCancelled ? cleanupFailure : error)
          state = userCancelled && fatal === undefined ? 'cancelled' : 'failed'
          reason = state === 'cancelled' ? null : askError(fatal)
        }
        try { recorder.finish(state, reason) }
        catch (failure) {
          task.undurable = true
          // Hold this Session's tail until terminal persistence succeeds. Never replay a tool.
          while (task.undurable) {
            try { recorder.finish('failed', state === 'failed' ? reason : askError(failure)); task.undurable = false }
            catch { if (disposed) break; await new Promise(resolve => setTimeout(resolve, 100)) }
          }
        } finally {
          controller.abort(); await run?.close().catch(() => {}); task.settled = true
          for (const [id, old] of tasks) if (tasks.size > 64 && old.settled && !old.undurable) tasks.delete(id)
        }
      })
      // A cancelled queued Run may settle early, but its successor still waits for all predecessors.
      const tail = Promise.allSettled([prior, task.done]).then(() => { if (tails.get(result.sessionId) === tail) tails.delete(result.sessionId) })
      tails.set(result.sessionId, tail)
      return result
    },
    cancel(owner: number, input: unknown) { const { runId, task } = owned(owner, input); if (!task) { if (deps.chats.getRun(runId).state === 'running') fail('FORBIDDEN'); return null }; task.controller.abort(); return null },
    getRun(owner: number, input: unknown) { const { runId, task } = owned(owner, input); if (task) deps.chats.getRun(runId); return structuredClone(task?.snapshot ?? deps.chats.snapshot(runId)) },
    listActive(owner: number, input: unknown) { v.object({})(input); return [...tasks.values()].filter(t => t.owner === owner && t.snapshot.run.state === 'running').map(t => structuredClone(t.snapshot)) },
    disposeOwner(owner: number) { for (const task of tasks.values()) if (task.owner === owner) task.controller.abort() },
    async dispose() { disposed = true; for (const task of tasks.values()) task.controller.abort(); await Promise.allSettled([...tasks.values()].map(t => t.done)); tasks.clear() }
  }
}
export type AskAgentTasks = ReturnType<typeof createAskAgentTasks>
