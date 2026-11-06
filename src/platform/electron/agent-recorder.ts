import type { AgentRunEvent, AgentItem, AgentSnapshot, ChatRunState } from '../../domain/chat/chat.types'
import type { ChatRecorder } from '../database/repositories/chats'
import type { AgentCompletion } from '../agent/engine'
import type { AgentRuntimeEvent } from '../../shared/agent'
import { isPotentialWrite, presentTool } from '../agent/tool-presentation'
import { redactTranscript } from './transcript-redaction'

/** Only trusted runtime events reach storage. Renderer cannot fabricate timeline output. */
export function createAgentRecorder<S extends string | null>(repo: ChatRecorder, snapshot: AgentSnapshot<S>, send: (event: AgentRunEvent<S>) => void, onFailure: (error: unknown) => void) {
  const mapping = new Map<string, AgentItem<S>>(), potentialWrites = new Set<string>()
  let checkpointAt = Date.now(), cycleFailureReason: string | undefined
  const emit = (event: Omit<AgentRunEvent<S>, 'sessionId' | 'runId' | 'eventSequence'>) => {
    snapshot.run.eventSequence++
    send({ ...event, sessionId: snapshot.run.sessionId, runId: snapshot.run.id, eventSequence: snapshot.run.eventSequence } as AgentRunEvent<S>)
  }
  function flush() { repo.checkpoint(snapshot); checkpointAt = Date.now() }
  function itemEvent(type: 'item.started' | 'item.completed' | 'item.failed', item: AgentItem<S>) {
    snapshot.run.eventSequence++
    flush()
    send({ type, item: structuredClone(item), sessionId: item.sessionId, runId: item.runId, eventSequence: snapshot.run.eventSequence })
  }
  const timer = setInterval(() => { try { flush() } catch (error) { clearInterval(timer); onFailure(error) } }, 1000)
  timer.unref()
  return {
    snapshot,
    started() { emit({ type: 'run.started', run: structuredClone(snapshot.run) } as AgentRunEvent<S>); flush() },
    status(status: NonNullable<AgentSnapshot['run']['runtimeStatus']>) {
      snapshot.run.runtimeStatus = status; snapshot.run.eventSequence++
      repo.runtimeStatus(snapshot.run.id, status, snapshot.run.eventSequence)
      send({ type: 'runtime.status', status, run: structuredClone(snapshot.run), sessionId: snapshot.run.sessionId,
        runId: snapshot.run.id, eventSequence: snapshot.run.eventSequence })
    },
    receive(event: AgentRuntimeEvent) {
      if (event.type === 'cycle.started') { repo.startCycle(snapshot.run.id, event.index, event.startedAt); return }
      if (event.type === 'cycle.settled') { repo.settleCycle(snapshot.run.id, event.index, event.status, event.reason, event.finishedAt); return }
      if (event.type === 'model.request.prepared') { repo.saveModelRequest(snapshot.run.id, event.request, event.cycleIndex); return }
      if (event.type === 'model.request.activation') { repo.saveActivationDiagnostic(snapshot.run.id, event.activation); return }
      if (event.type === 'model.completed') {
        repo.saveProviderResponse(snapshot.run.id, { ...event.response,
          toolCalls: event.response.toolCalls.map(call => ({ ...call, arguments: redactTranscript(call.arguments) })) }, snapshot.items.at(-1)?.sequence ?? 0, event.cycleIndex)
        return
      }
      if (event.type === 'segment.started' || event.type === 'tool.started') {
        const tool = event.type === 'tool.started'
        const write = tool && isPotentialWrite(event.call.name, event.risk)
        if (write) { snapshot.run.writeStarted = true; flush() }
        const item = repo.append<S>(snapshot.run.id, tool ? { type: 'tool_call', toolName: event.call.name, callId: event.call.id,
          arguments: redactTranscript(event.call.arguments), display: presentTool(event.call.name) } : { type: event.kind, text: '', ...(event.reasoning ? { reasoning: event.reasoning } : {}) }, tool ? 'running' : 'streaming')
        if (write) potentialWrites.add(item.id)
        mapping.set(event.id, item); snapshot.items.push(item); itemEvent('item.started', item)
        return
      }
      if ((event.type === 'tool.completed' || event.type === 'tool.failed') && event.guard?.status === 'BLOCKED') cycleFailureReason = event.guard.reason
      if (event.type === 'tool.failed' && event.uncertain) cycleFailureReason = 'WRITE_OUTCOME_UNKNOWN'
      const item = mapping.get(event.id)
      if (!item) throw new Error('AGENT_PROTOCOL_ERROR')
      item.updatedAt = new Date().toISOString()
      if (event.type === 'segment.delta') {
        if (item.content.type === 'tool_call') throw new Error('AGENT_PROTOCOL_ERROR')
        item.content.text += event.text
        emit({ type: 'item.delta', itemId: item.id, delta: event.text } as AgentRunEvent<S>)
        if (Date.now() - checkpointAt >= 1000) flush()
      } else {
        item.state = 'completed'
        if (event.type === 'tool.completed' && item.content.type === 'tool_call') item.content = { ...item.content, display: presentTool(event.name, event.result), result: redactTranscript(event.result), guard: event.guard, durationMs: event.durationMs }
        if (event.type === 'tool.failed') {
          item.state = event.uncertain ? 'uncertain' : 'failed'
          if (item.content.type === 'tool_call') item.content = { ...item.content, display: presentTool(event.name), error: event.error, guard: event.guard, durationMs: event.durationMs }
        }
        itemEvent(item.state === 'completed' ? 'item.completed' : 'item.failed', item)
      }
    },
    finish(state: Exclude<ChatRunState, 'running'>, error: string | null) {
      clearInterval(timer)
      const terminal = structuredClone(snapshot)
      const finishedAt = new Date().toISOString()
      const pending = terminal.items.filter(item => item.state === 'streaming' || item.state === 'running')
      for (const item of pending) {
        item.state = potentialWrites.has(item.id) ? 'uncertain' : state === 'cancelled' ? 'cancelled' : state === 'interrupted' ? 'interrupted' : 'failed'
        item.updatedAt = finishedAt
      }
      Object.assign(terminal.run, { state, error, finishedAt, runtimeStatus: 'idle', eventSequence: terminal.run.eventSequence + pending.length + 1 })
      repo.finish(terminal, state === 'cancelled' ? 'USER_CANCELLED' : state === 'failed' || state === 'interrupted' ? cycleFailureReason ?? error : null)
      const sequence = snapshot.run.eventSequence
      Object.assign(snapshot, terminal)
      pending.forEach((item, index) => send({ type: 'item.failed', item: structuredClone(item), sessionId: item.sessionId, runId: item.runId, eventSequence: sequence + index + 1 }))
      send({ type: state === 'completed' ? 'run.completed' : state === 'cancelled' ? 'run.cancelled' : state === 'interrupted' ? 'run.interrupted' : 'run.failed', run: structuredClone(snapshot.run), sessionId: snapshot.run.sessionId, runId: snapshot.run.id, eventSequence: snapshot.run.eventSequence })
    }
  }
}

/** A failed terminal commit prevents downstream work and holds the owner until persistence settles. */
export async function finishAgentRecord(
  finish: ReturnType<typeof createAgentRecorder>['finish'], outcome: AgentCompletion, errorCode: (error: unknown) => string, stopping: () => boolean
): Promise<AgentCompletion> {
  let terminal = outcome
  for (;;) {
    try { finish(terminal.state, terminal.error); return terminal }
    catch (error) {
      terminal = { state: 'failed', finalText: '', error: terminal.state === 'failed' ? terminal.error : errorCode(error) }
      if (stopping()) return terminal
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}
