import { AgentError, type AgentRuntimeEvent, type StreamingAgentModel } from '../../shared/agent'
import type { ModelCapabilities } from '../../shared/ai'
import type { Language } from '../../shared/settings'
import type { ChatSnapshot, AgentRunEvent } from '../../domain/chat/chat.types'
import { chatStart } from '../../domain/chat/chat.validation'
import * as v from '../../domain/common/validation'
import { DataError, fail } from '../../domain/common/errors'
import type { ChatRecorder } from '../database/repositories/chats'
import type { FirstPartyRuntime } from '../mcp/first-party-client'
import { ToolError } from '../../shared/tools/errors'
import { createAgentEngine, type AgentEngine } from '../agent/engine'
import { updateResourceRecords } from '../agent/context/resources'
import { createAgentRecorder, finishAgentRecord } from './agent-recorder'

export function askError(error: unknown): string {
  if (error instanceof DataError || error instanceof AgentError || error instanceof ToolError) return error.code
  return 'AI_PROVIDER_FAILED'
}
interface Task { owner: number; controller: AbortController; snapshot: ChatSnapshot; done?: Promise<void>; settled?: boolean; failure?: unknown }
export function createAskAgentTasks(deps: { chats: ChatRecorder; mcp: FirstPartyRuntime; engine?: AgentEngine; language(): Language;
  capabilities(choice: { providerId: string; modelId: string }, signal: AbortSignal): Promise<ModelCapabilities>;
  model(choice: { providerId: string; modelId: string }): StreamingAgentModel }) {
  const tasks = new Map<string, Task>(), tails = new Map<string, Promise<void>>()
  const engine = deps.engine ?? createAgentEngine()
  let disposed = false
  function owned(owner: number, input: unknown) {
    const { runId } = v.object({ runId: v.id })(input), task = tasks.get(runId)
    if (task && task.owner !== owner) fail('FORBIDDEN')
    return { runId, task }
  }
  return {
    start(owner: number, input: unknown, send: (event: AgentRunEvent) => void, smartPaste?: { onToolTurn(): void }) {
      if (disposed) fail('INVALID_STATE')
      const args = chatStart(input)
      if (Buffer.byteLength(args.message.trim()) > 1048576) fail('INVALID_INPUT')
      if (smartPaste && args.sessionId) fail('INVALID_INPUT')
      const normalized = { ...args, sessionId: args.sessionId || undefined }, previous = deps.chats.lookup(normalized)
      if (previous) { owned(owner, { runId: previous.runId }); return previous }
      if ([...tasks.values()].filter(t => !t.settled).length >= 16
        || [...tasks.values()].filter(t => t.owner === owner && !t.settled).length >= 4) fail('INVALID_STATE')
      const language = deps.language()
      const result = deps.chats.start(normalized, true, smartPaste ? 'smart-paste' : undefined)
      const snapshot = deps.chats.snapshot(result.runId), controller = new AbortController()
      const task: Task = { owner, controller, snapshot }; tasks.set(result.runId, task)
      const recorder = createAgentRecorder(deps.chats, snapshot, event => { try { send(event) } catch { /* Renderer loss has owner disposal. */ } }, error => { task.failure = error; controller.abort() })
      function receive(event: AgentRuntimeEvent) {
        try { recorder.receive(event) }
        catch (error) { task.failure ??= error; throw error }
      }
      const prior = tails.get(result.sessionId) ?? Promise.resolve()
      const user = snapshot.items[0], sessionId = result.sessionId
      const handle = engine.start({
        invocation: { agent: 'ask', source: smartPaste ? 'smart-paste' : 'chat', message: args.message, sessionId, language },
        requestId: args.requestId, model: args.choice, signal: controller.signal, onEvent: receive
      }, {
        runId: result.runId, prior, model: deps.model, capabilities: deps.capabilities,
        started: recorder.started, error: askError, failure: () => task.failure, onToolTurn: smartPaste?.onToolTurn,
        async open(signal) {
          deps.chats.admit(result.runId); snapshot.run.admission = 'admitted'
          const session = await deps.mcp.openAgentRun({ agent: 'ask', agentRunId: result.runId, sessionId, sourceMessageIds: [user.id], signal, readOnly: Boolean(smartPaste) })
          return { ...session, signal: session.tools.signal }
        },
        history: () => ({ checkpoint: deps.chats.context(sessionId), turns: deps.chats.contextTurns(sessionId, user.sequence, args.choice),
          protectedState: deps.chats.protectedState(sessionId), save: (value, revision) => deps.chats.saveContext(sessionId, value, revision) }),
        protect: record => deps.chats.saveProtected(sessionId, updateResourceRecords(deps.chats.protectedState(sessionId), record)),
        status: recorder.status,
        finish: outcome => finishAgentRecord(recorder.finish, outcome, askError, () => disposed)
      })
      task.done = handle.completion.then(() => {}).finally(() => {
        controller.abort(); task.settled = true
        for (const [id, old] of tasks) if (tasks.size > 64 && old.settled) tasks.delete(id)
      })
      // A cancelled queued Run may settle early, but its successor still waits for all predecessors.
      const tail = Promise.allSettled([prior, task.done]).then(() => { if (tails.get(result.sessionId) === tail) tails.delete(result.sessionId) })
      tails.set(result.sessionId, tail)
      return result
    },
    cancel(owner: number, input: unknown) { const { runId, task } = owned(owner, input); if (!task) { if (deps.chats.getRun(runId).state === 'running') fail('FORBIDDEN'); return null }; engine.cancel(runId); task.controller.abort(); return null },
    getRun(owner: number, input: unknown) { const { runId, task } = owned(owner, input); if (task) deps.chats.getRun(runId); return structuredClone(task?.snapshot ?? deps.chats.snapshot(runId)) },
    listActive(owner: number, input: unknown) { v.object({})(input); return [...tasks.values()].filter(t => t.owner === owner && t.snapshot.run.state === 'running').map(t => structuredClone(t.snapshot)) },
    disposeOwner(owner: number) { for (const task of tasks.values()) if (task.owner === owner) task.controller.abort() },
    async dispose() { disposed = true; for (const task of tasks.values()) task.controller.abort(); await Promise.allSettled([...tasks.values()].map(t => t.done)); tasks.clear() }
  }
}
export type AskAgentTasks = ReturnType<typeof createAskAgentTasks>
