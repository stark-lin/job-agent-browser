import type { AgentRunEvent } from '../../domain/chat/chat.types'
import type { ResumeTrace } from '../../platform/electron/resume-contract'

/** A sequence gap requires a fresh live snapshot before applying more deltas. */
export function applyResumeTraceEvent(trace: ResumeTrace, event: AgentRunEvent<string | null>): ResumeTrace | null {
  if (event.runId !== trace.run.id || event.eventSequence <= trace.run.eventSequence) return trace
  if (event.eventSequence !== trace.run.eventSequence + 1) return null
  const next = { ...trace, run: { ...trace.run, eventSequence: event.eventSequence } }
  if (event.type === 'item.delta') {
    const item = trace.items.find(item => item.id === event.itemId)
    if (!item || item.content.type === 'tool_call') return null
    const updated = { ...item, updatedAt: new Date().toISOString(), content: { ...item.content, text: item.content.text + event.delta } }
    next.items = trace.items.map(item => item.id === updated.id ? updated : item)
  } else if ('item' in event) next.items = [...trace.items.filter(item => item.id !== event.item.id), event.item].sort((a, b) => a.sequence - b.sequence)
  else next.run = { ...event.run, eventSequence: event.eventSequence }
  return next
}
