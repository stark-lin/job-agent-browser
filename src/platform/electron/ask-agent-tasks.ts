import { AgentError, type StreamingAgentModel } from '../../shared/agent'
import type { ChatSnapshot, AgentRunEvent } from '../../domain/chat/chat.types'
import { chatStart } from '../../domain/chat/chat.validation'
import * as v from '../../domain/common/validation'
import { DataError, fail } from '../../domain/common/errors'
import type { ChatRecorder } from '../database/repositories/chats'
import type { FirstPartyRuntime } from '../mcp/first-party-client'
import { ToolError } from '../../shared/tools/errors'
import { runAskAgent } from '../agent/ask'
import { ASK_AI_TOOL_ALLOWLIST } from '../agent/tool-presentation'
import { createAskRecorder } from './ask-agent-recorder'

export function askError(error: unknown): string {
  if (error instanceof DataError || error instanceof AgentError || error instanceof ToolError) return error.code
  return 'AI_PROVIDER_FAILED'
}
interface Task { owner: number; controller: AbortController; snapshot: ChatSnapshot; done?: Promise<void>; failure?: unknown; undurable?: boolean }
export function createAskAgentTasks(deps: { chats: ChatRecorder; mcp: FirstPartyRuntime; model(choice: { providerId: string; modelId: string }): StreamingAgentModel }) {
  const tasks = new Map<string, Task>()
  let disposed = false
  const recovery = setInterval(() => {
    for (const task of tasks.values()) if (task.undurable) {
      try { deps.chats.finish(task.snapshot); task.undurable = false } catch { /* Retry transcript persistence only; never replay business writes. */ }
    }
  }, 5000)
  recovery.unref()
  function owned(owner: number, input: unknown) {
    const { runId } = v.object({ runId: v.id })(input), task = tasks.get(runId)
    if (task && task.owner !== owner) fail('FORBIDDEN')
    return { runId, task }
  }
  return {
    start(owner: number, input: unknown, send: (event: AgentRunEvent) => void) {
      if (disposed) fail('INVALID_STATE')
      const args = chatStart(input)
      if (Buffer.byteLength(args.message.trim()) > 260096) fail('INVALID_INPUT')
      const normalized = { ...args, sessionId: args.sessionId || undefined }
      const previous = deps.chats.lookup(normalized)
      if (previous) { owned(owner, { runId: previous.runId }); return previous }
      if ([...tasks.values()].filter(t => t.snapshot.run.state === 'running').length >= 16
        || [...tasks.values()].filter(t => t.owner === owner && t.snapshot.run.state === 'running').length >= 4) fail('INVALID_STATE')
      // Resolve credentials/configuration before creating any durable empty conversation.
      const model = deps.model(args.choice), result = deps.chats.start(normalized)
      const snapshot = deps.chats.snapshot(result.runId), controller = new AbortController()
      const task: Task = { owner, controller, snapshot }; tasks.set(result.runId, task)
      const recorder = createAskRecorder(deps.chats, snapshot, event => { try { send(event) } catch { /* Renderer loss is handled by owner disposal. */ } }, error => { task.failure = error; controller.abort() })
      task.done = new Promise(resolve => setImmediate(() => {
        void (async () => {
          recorder.started()
          const tools = await deps.mcp.session('ask-ai', controller.signal)
          const signal = AbortSignal.any([controller.signal, tools.signal])
          const user = snapshot.items[0]
          const history = deps.chats.history(result.sessionId, user.sequence, 262144 - Buffer.byteLength(args.message.trim()) - 2048)
          await runAskAgent(model, tools.view(ASK_AI_TOOL_ALLOWLIST), history.map(m => m.role === 'assistant' ? { role: 'assistant', content: m.content, toolCalls: [] } : { role: 'user', content: m.content }), args.message.trim(), signal, recorder.receive)
          signal.throwIfAborted()
          recorder.finish('completed', null)
        })().catch(error => {
          const cancelled = controller.signal.aborted && !task.failure
          try { recorder.finish(cancelled ? 'cancelled' : 'failed', cancelled ? null : askError(task.failure ?? error)) }
          catch (failure) {
            task.undurable = true; snapshot.run.state = 'failed'; snapshot.run.error = askError(failure); snapshot.run.finishedAt = new Date().toISOString(); snapshot.run.eventSequence++
            try { send({ type: 'run.failed', run: structuredClone(snapshot.run), sessionId: snapshot.run.sessionId, runId: snapshot.run.id, eventSequence: snapshot.run.eventSequence }) } catch { /* Window is unavailable. */ }
          }
        }).finally(() => {
          // Retain a bounded terminal snapshot for acknowledgement/resync races.
          for (const [id, old] of tasks) if (tasks.size > 64 && old.snapshot.run.state !== 'running' && !old.undurable) tasks.delete(id)
          resolve()
        })
      }))
      return result
    },
    cancel(owner: number, input: unknown) { const { runId, task } = owned(owner, input); if (!task) { if (deps.chats.getRun(runId).state === 'running') fail('FORBIDDEN'); return null }; if (task.snapshot.run.state === 'running') task.controller.abort(); return null },
    getRun(owner: number, input: unknown) { const { runId, task } = owned(owner, input); if (task) deps.chats.getRun(runId); return structuredClone(task?.snapshot ?? deps.chats.snapshot(runId)) },
    listActive(owner: number, input: unknown) { v.object({})(input); return [...tasks.values()].filter(t => t.owner === owner && t.snapshot.run.state === 'running').map(t => structuredClone(t.snapshot)) },
    disposeOwner(owner: number) { for (const task of tasks.values()) if (task.owner === owner) task.controller.abort() },
    async dispose() { disposed = true; clearInterval(recovery); for (const task of tasks.values()) task.controller.abort(); await Promise.allSettled([...tasks.values()].map(t => t.done)); tasks.clear() }
  }
}
export type AskAgentTasks = ReturnType<typeof createAskAgentTasks>
