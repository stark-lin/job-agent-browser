import type { AgentRunEvent, ChatItem, ChatSnapshot } from '../../domain/chat/chat.types'
import type { ChatRecorder } from '../database/repositories/chats'
import type { StreamLoopEvent } from '../agent/stream-loop'
import { isAskWrite, presentTool } from '../agent/tool-presentation'

/** Only trusted runtime events reach storage. Renderer cannot fabricate timeline output. */
export function createAskRecorder(repo: ChatRecorder, snapshot: ChatSnapshot, send: (event: AgentRunEvent) => void, onFailure: (error: unknown) => void) {
  const mapping = new Map<string, ChatItem>()
  let checkpointAt = Date.now()
  const emit = (event: Omit<AgentRunEvent, 'sessionId' | 'runId' | 'eventSequence'>) => {
    snapshot.run.eventSequence++
    send({ ...event, sessionId: snapshot.run.sessionId, runId: snapshot.run.id, eventSequence: snapshot.run.eventSequence } as AgentRunEvent)
  }
  function flush() { repo.checkpoint(snapshot); checkpointAt = Date.now() }
  function itemEvent(type: 'item.started' | 'item.completed' | 'item.failed', item: ChatItem) {
    snapshot.run.eventSequence++
    flush()
    send({ type, item: structuredClone(item), sessionId: item.sessionId, runId: item.runId, eventSequence: snapshot.run.eventSequence })
  }
  const timer = setInterval(() => { try { flush() } catch (error) { clearInterval(timer); onFailure(error) } }, 1000)
  timer.unref()
  return {
    snapshot,
    started() { emit({ type: 'run.started', run: structuredClone(snapshot.run) } as AgentRunEvent); flush() },
    receive(event: StreamLoopEvent) {
      if (event.type === 'segment.started' || event.type === 'tool.started') {
        const tool = event.type === 'tool.started'
        if (tool && isAskWrite(event.call.name)) { snapshot.run.writeStarted = true; flush() }
        const item = repo.append(snapshot.run.id, tool ? { type: 'tool_call', toolName: event.call.name, display: presentTool(event.call.name) } : { type: event.kind, text: '' }, tool ? 'running' : 'streaming')
        mapping.set(event.id, item); snapshot.items.push(item); itemEvent('item.started', item)
        return
      }
      const item = mapping.get(event.id)
      if (!item) throw new Error('AGENT_PROTOCOL_ERROR')
      item.updatedAt = new Date().toISOString()
      if (event.type === 'segment.delta') {
        if (item.content.type === 'tool_call') throw new Error('AGENT_PROTOCOL_ERROR')
        item.content.text += event.text
        emit({ type: 'item.delta', itemId: item.id, delta: event.text } as AgentRunEvent)
        if (Date.now() - checkpointAt >= 1000) flush()
      } else {
        item.state = 'completed'
        if (event.type === 'tool.completed') item.content = { type: 'tool_call', toolName: event.name, display: presentTool(event.name, event.result), durationMs: event.durationMs }
        if (event.type === 'tool.failed') {
          item.state = event.uncertain && isAskWrite(event.name) ? 'uncertain' : 'failed'
          item.content = { type: 'tool_call', toolName: event.name, display: presentTool(event.name), error: event.error, durationMs: event.durationMs }
        }
        itemEvent(item.state === 'completed' ? 'item.completed' : 'item.failed', item)
      }
    },
    finish(state: 'completed' | 'cancelled' | 'failed', error: string | null) {
      clearInterval(timer)
      for (const item of snapshot.items) if (['streaming', 'running'].includes(item.state)) {
        item.state = item.content.type === 'tool_call' && isAskWrite(item.content.toolName) ? 'uncertain' : state === 'cancelled' ? 'cancelled' : 'failed'
        item.updatedAt = new Date().toISOString()
        itemEvent('item.failed', item)
      }
      snapshot.run.state = state; snapshot.run.error = error; snapshot.run.finishedAt = new Date().toISOString(); snapshot.run.eventSequence++
      repo.finish(snapshot)
      send({ type: state === 'completed' ? 'run.completed' : state === 'cancelled' ? 'run.cancelled' : 'run.failed', run: structuredClone(snapshot.run), sessionId: snapshot.run.sessionId, runId: snapshot.run.id, eventSequence: snapshot.run.eventSequence })
    }
  }
}
