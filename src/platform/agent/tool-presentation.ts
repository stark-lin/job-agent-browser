import type { ToolDisplay, ToolSummaryKey } from '../../domain/chat/chat.types'

export const ASK_AI_TOOL_ALLOWLIST = [
  'job.list', 'job.get', 'job.update', 'job.set_archived', 'profile.list', 'profile.get', 'profile.list_facts',
  'application.get', 'application.list_events', 'application.set_status', 'application.add_note',
  'application.schedule_event', 'application.reschedule_event', 'artifact.get'
] as const
const labels: Record<string, ToolSummaryKey> = {
  'job.list': 'jobs', 'job.get': 'job', 'job.update': 'updateJob', 'job.set_archived': 'archiveJob',
  'profile.list': 'profiles', 'profile.get': 'profile', 'profile.list_facts': 'facts', 'application.get': 'application',
  'application.list_events': 'events', 'application.set_status': 'setStatus', 'application.add_note': 'addNote',
  'application.schedule_event': 'schedule', 'application.reschedule_event': 'reschedule', 'artifact.get': 'artifact'
}
export const isAskWrite = (name: string) => ['job.update', 'job.set_archived', 'application.set_status', 'application.add_note', 'application.schedule_event', 'application.reschedule_event'].includes(name)
/** Allowlisted scalar summaries only: raw arguments/results never enter the transcript. */
export function presentTool(name: string, result?: unknown): ToolDisplay {
  const display: ToolDisplay = { key: labels[name] ?? 'tool' }
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const value = result as Record<string, unknown>
    if (Number.isSafeInteger(value.total) && Number(value.total) >= 0) display.count = Number(value.total)
    if (typeof value.status === 'string' && ['NOT_STARTED', 'PREPARING', 'APPLIED', 'INTERVIEW', 'OFFER', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'].includes(value.status)) display.status = value.status
    if (typeof value.startsAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.startsAt) && Number.isFinite(Date.parse(value.startsAt))) display.startsAt = value.startsAt
  }
  return display
}
