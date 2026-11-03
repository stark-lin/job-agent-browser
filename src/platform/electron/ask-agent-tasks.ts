import { AgentError, abortable, type StreamingAgentModel } from '../../shared/agent'
import { allowsParallelImport, type AISettings, type ModelCapabilities } from '../../shared/ai'
import type { MemoryProgress, AskRuntimeStatus } from '../../shared/ask'
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
import { resourceRecord, updateResourceRecords } from '../agent/context/resources'
import { MemoryManager, memorySnapshot } from '../agent/memory/manager'
import { createAskRecorder } from './ask-agent-recorder'

export function askError(error: unknown): string {
  if (error instanceof DataError || error instanceof AgentError || error instanceof ToolError) return error.code
  return 'AI_PROVIDER_FAILED'
}
interface Task { owner: number; controller: AbortController; snapshot: ChatSnapshot; done?: Promise<void>; settled?: boolean; failure?: unknown; undurable?: boolean; status?(value: AskRuntimeStatus): void }
export function createAskAgentTasks(deps: { chats: ChatRecorder; mcp: FirstPartyRuntime; settings(): AISettings;
  capabilities(choice: { providerId: string; modelId: string }, signal: AbortSignal): Promise<ModelCapabilities>;
  model(choice: { providerId: string; modelId: string }): StreamingAgentModel }) {
  const tasks = new Map<string, Task>(), tails = new Map<string, Promise<void>>()
  const memoryWork = new Map<string, Promise<void>>(), waiting = new Map<string, Set<() => void>>()
  const retryControllers = new Map<AbortController, number>()
  let disposed = false, commitTail: Promise<unknown> = Promise.resolve()
  function commit<T>(operation: () => Promise<T>) {
    const next = commitTail.catch(() => {}).then(operation); commitTail = next; return next
  }
  const recovery = setInterval(() => {
    for (const task of tasks.values()) if (task.undurable) {
      try { deps.chats.finish(task.snapshot); task.undurable = false } catch { /* Retry persistence only, never business writes. */ }
    }
  }, 5000)
  recovery.unref()
  function owned(owner: number, input: unknown) {
    const { runId } = v.object({ runId: v.id })(input), task = tasks.get(runId)
    if (task && task.owner !== owner) fail('FORBIDDEN')
    return { runId, task }
  }
  function memory(sessionId: string, progress: MemoryProgress, model: StreamingAgentModel, budget: ContextBudget, signal: AbortSignal) {
    const key = progress.messageId, existing = memoryWork.get(key)
    if (existing) return abortable(existing, signal)
    const work = (async () => {
      const source = { ...deps.chats.sourceMessage(progress.messageId), evidence: deps.chats.memoryEvidence(sessionId, progress.sequence) }
      while (source.evidence.length && budget.tokens.count(source.evidence) > budget.input * 0.15) source.evidence.shift()
      const tools = await deps.mcp.session('ask-memory', signal, sessionId, [source.id, ...source.evidence.map(s => s.id)])
      try { await new MemoryManager({ model, tools, budget, source, progress, save: value => deps.chats.saveMemory(sessionId, value), commit }).run(signal) }
      finally { await tools.close() }
    })().finally(() => memoryWork.delete(key))
    memoryWork.set(key, work); return work
  }
  function waitForRetry(sessionId: string, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const listeners = waiting.get(sessionId) ?? new Set<() => void>(); waiting.set(sessionId, listeners)
      const done = () => { listeners.delete(done); signal.removeEventListener('abort', abort); resolve() }
      const abort = () => { listeners.delete(done); signal.removeEventListener('abort', abort); reject(new AgentError('AGENT_CANCELLED')) }
      listeners.add(done); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
    })
  }
  function memoryRecovered(sessionId: string) {
    for (const task of tasks.values()) if (task.snapshot.run.sessionId === sessionId && task.snapshot.run.state !== 'running'
      && ['memory.updating', 'memory.failed'].includes(task.snapshot.run.runtimeStatus ?? '')) task.status?.('idle')
    deps.chats.reconcileMemoryStatus(sessionId)
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
      const model = deps.model(args.choice), result = deps.chats.start(normalized, true)
      const snapshot = deps.chats.snapshot(result.runId), controller = new AbortController()
      const capabilities = deps.capabilities(args.choice, controller.signal)
      void capabilities.catch(() => {}) // A queued turn observes this result only after its predecessor settles.
      const task: Task = { owner, controller, snapshot }; tasks.set(result.runId, task)
      const recorder = createAskRecorder(deps.chats, snapshot, event => { try { send(event) } catch { /* Renderer loss has owner disposal. */ } }, error => { task.failure = error; controller.abort() })
      function status(value: AskRuntimeStatus) {
        snapshot.run.runtimeStatus = value; snapshot.run.eventSequence++
        deps.chats.runtimeStatus(result.runId, value, snapshot.run.eventSequence)
        try { send({ type: 'runtime.status', status: value, run: structuredClone(snapshot.run), sessionId: result.sessionId, runId: result.runId, eventSequence: snapshot.run.eventSequence }) } catch { /* Renderer unavailable. */ }
      }
      task.status = status
      const prior = tails.get(result.sessionId) ?? Promise.resolve()
      const parallel = allowsParallelImport(deps.settings(), args.choice)
      task.done = new Promise(resolve => setImmediate(() => {
        void (async () => {
          recorder.started(); status('pending')
          await abortable(prior.catch(() => {}), controller.signal); controller.signal.throwIfAborted()
          const budget = new ContextBudget(await capabilities, args.choice.modelId)
          budget.assert([{ role: 'system', content: askSystem }, { role: 'user', content: args.message.trim() }], discoveryTools)
          const user = snapshot.items[0], sessionId = result.sessionId
          async function recoverMemory(beforeSequence: number) {
            for (;;) {
              const outstanding = deps.chats.memoryProgress(sessionId, beforeSequence).filter(p => !['committed', 'no_change'].includes(p.phase))
              if (!outstanding.length) { memoryRecovered(sessionId); return }
              try { for (const progress of outstanding) { status('memory.updating'); await memory(sessionId, progress, model, budget, controller.signal) } }
              catch { controller.signal.throwIfAborted(); status('memory.failed'); await waitForRetry(sessionId, controller.signal) }
            }
          }
          await recoverMemory(user.sequence)
          deps.chats.admit(result.runId); snapshot.run.admission = 'admitted'
          const progress: MemoryProgress = { messageId: user.id, sequence: user.sequence, phase: 'pending', writes: [], nextWrite: 0, error: null }
          deps.chats.saveMemory(sessionId, progress)
          const tools = await deps.mcp.session('ask-ai', controller.signal, sessionId)
          const signal = AbortSignal.any([controller.signal, tools.signal])
          status('memory.updating')
          // Freeze the snapshot before this turn's parallel memory pipeline can commit.
          const fixedMemory = parallel ? await memorySnapshot(tools, budget, args.message, signal, model) : ''
          const memoryWork = memory(sessionId, progress, model, budget, signal)
          let memoryFailure: unknown, memorySettled = false
          const settledMemory = memoryWork.catch(error => { memoryFailure = error }).finally(() => { memorySettled = true })
          if (!parallel) {
            await settledMemory
            if (memoryFailure) { controller.signal.throwIfAborted(); status('memory.failed'); await waitForRetry(sessionId, controller.signal); await recoverMemory(user.sequence + 1); memoryFailure = undefined }
          }
          const context = new ContextManager({ budget, model, checkpoint: deps.chats.context(sessionId), turns: deps.chats.contextTurns(sessionId, user.sequence),
            memory: parallel ? fixedMemory : await memorySnapshot(tools, budget, args.message, signal, model), protectedState: deps.chats.protectedState(sessionId),
            save: (value, revision) => deps.chats.saveContext(sessionId, value, revision), compacting: () => status('context.compacting') })
          try {
            await runAskAgent({ model, tools, message: args.message.trim(), signal, budget, context, emit: recorder.receive, status,
              protect(name, input, output, uncertain) {
                const record = resourceRecord(name, input, output, uncertain)
                if (record) { deps.chats.saveProtected(sessionId, updateResourceRecords(deps.chats.protectedState(sessionId), record)); context.protect(record) }
              } })
            signal.throwIfAborted(); recorder.finish('completed', null)
            if (!memorySettled) status('memory.updating')
          } finally { await settledMemory }
          if (memoryFailure) { status('memory.failed'); return }
          status('idle')
        })().catch(error => {
          const cancelled = controller.signal.aborted && !task.failure
          if (snapshot.run.state !== 'running') return
          try {
            recorder.finish(cancelled ? 'cancelled' : 'failed', cancelled ? null : askError(task.failure ?? error))
            status(cancelled || !deps.chats.memoryProgress(snapshot.run.sessionId).some(p => !['committed', 'no_change'].includes(p.phase)) ? 'idle' : 'memory.failed')
          }
          catch (failure) {
            task.undurable = true; snapshot.run.state = 'failed'; snapshot.run.error = askError(failure); snapshot.run.finishedAt = new Date().toISOString(); snapshot.run.eventSequence++
            try { send({ type: 'run.failed', run: structuredClone(snapshot.run), sessionId: snapshot.run.sessionId, runId: snapshot.run.id, eventSequence: snapshot.run.eventSequence }) } catch { /* Window unavailable. */ }
          }
        }).finally(() => {
          task.settled = true
          for (const [id, old] of tasks) if (tasks.size > 64 && old.settled && !old.undurable) tasks.delete(id)
          resolve()
        })
      }))
      const tail = Promise.allSettled([prior, task.done]).then(() => { if (tails.get(result.sessionId) === tail) tails.delete(result.sessionId) })
      tails.set(result.sessionId, tail)
      return result
    },
    cancel(owner: number, input: unknown) { const { runId, task } = owned(owner, input); if (!task) { if (deps.chats.getRun(runId).state === 'running') fail('FORBIDDEN'); return null }; task.controller.abort(); return null },
    async retryMemory(owner: number, input: unknown) {
      const { runId, task } = owned(owner, input), snapshot = task?.snapshot ?? deps.chats.snapshot(runId)
      if (task && snapshot.run.state === 'running' && snapshot.run.runtimeStatus !== 'memory.failed') fail('INVALID_STATE')
      const controller = new AbortController(), choice = { providerId: snapshot.run.providerId, modelId: snapshot.run.modelId }
      retryControllers.set(controller, owner)
      try {
        const budget = new ContextBudget(await deps.capabilities(choice, controller.signal), choice.modelId)
        for (const progress of deps.chats.memoryProgress(snapshot.run.sessionId).filter(p => !['committed', 'no_change'].includes(p.phase))) await memory(snapshot.run.sessionId, progress, deps.model(choice), budget, controller.signal)
        for (const prior of tasks.values()) if (prior.snapshot.run.sessionId === snapshot.run.sessionId && prior.snapshot.run.runtimeStatus === 'memory.failed') prior.status?.('idle')
        memoryRecovered(snapshot.run.sessionId)
        for (const wake of waiting.get(snapshot.run.sessionId) ?? []) wake()
      } finally { retryControllers.delete(controller) }
      return null
    },
    getRun(owner: number, input: unknown) { const { runId, task } = owned(owner, input); if (task) deps.chats.getRun(runId); return structuredClone(task?.snapshot ?? deps.chats.snapshot(runId)) },
    listActive(owner: number, input: unknown) { v.object({})(input); return [...tasks.values()].filter(t => t.owner === owner && (t.snapshot.run.state === 'running' || t.snapshot.run.runtimeStatus === 'memory.updating')).map(t => structuredClone(t.snapshot)) },
    disposeOwner(owner: number) { for (const [controller, origin] of retryControllers) if (origin === owner) controller.abort(); for (const task of tasks.values()) if (task.owner === owner) task.controller.abort() },
    async dispose() { disposed = true; clearInterval(recovery); for (const controller of retryControllers.keys()) controller.abort(); for (const task of tasks.values()) task.controller.abort(); await Promise.allSettled([...tasks.values()].map(t => t.done)); await Promise.allSettled(memoryWork.values()); tasks.clear() }
  }
}
export type AskAgentTasks = ReturnType<typeof createAskAgentTasks>
