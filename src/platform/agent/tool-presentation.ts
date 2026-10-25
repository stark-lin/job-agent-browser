import type { ToolDisplay, ToolSummaryKey } from '../../domain/chat/chat.types'

const labels: Record<string, ToolSummaryKey> = {
  'job.list': 'jobs', 'job.get': 'job', 'job.update': 'updateJob', 'job.set_archived': 'archiveJob',
  'profile.list_items': 'profileItems', 'profile.create': 'createProfile', 'profile.update': 'updateProfile',
  'profile.add_item': 'addProfileItem', 'profile.update_item': 'updateProfileItem', 'profile.add_fact': 'addProfileFact', 'profile.update_fact': 'updateProfileFact',
  'profile.list': 'profiles', 'profile.get': 'profile', 'profile.list_facts': 'facts', 'application.get': 'application',
  'application.list_events': 'events', 'application.set_status': 'setStatus', 'application.add_note': 'addNote',
  'application.schedule_event': 'schedule', 'application.reschedule_event': 'reschedule', 'artifact.get': 'artifact',
  'job.import': 'importJob', 'resume.start': 'startResume', 'resume.get_context': 'resumeContext', 'resume.list_facts': 'resumeFacts',
  'resume.submit_scores': 'scoreResume', 'resume.submit_gate': 'checkResume', 'resume.submit_selection': 'selectResume',
  'resume.submit_draft': 'draftResume', 'resume.submit_polished': 'polishResume', 'resume.publish': 'publishResume',
  'resume.fail': 'failResume', 'resume.cancel': 'cancelResume', 'artifact.build': 'buildArtifact'
}
// Treat unknown future capabilities as writes so interruption never suggests a safe replay.
const readTools = new Set(['job.list', 'job.get', 'profile.list', 'profile.get', 'profile.list_facts', 'profile.list_items',
  'application.get', 'application.list_events', 'resume.get_context', 'resume.list_facts', 'artifact.get'])
export const isAskWrite = (name: string) => !readTools.has(name)
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
