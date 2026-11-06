import type { ToolDisplay, ToolSummaryKey } from '../../domain/chat/chat.types'

const labels: Record<string, ToolSummaryKey> = {
  'tool.search': 'searchTools', 'tool.activate': 'activateTools',
  'memory.list': 'memoryRead', 'memory.read': 'memoryRead', 'memory.recall': 'memoryRead', 'memory.write': 'memoryWrite', 'memory.mkdir': 'memoryWrite',
  'knowledge.list':'knowledgeRead','knowledge.read':'knowledgeRead','knowledge.search':'knowledgeRead','knowledge.retrieve':'knowledgeRead','knowledge.write':'knowledgeWrite','knowledge.mkdir':'knowledgeWrite','knowledge.move':'knowledgeWrite','knowledge.delete':'knowledgeWrite',
  'job.list': 'jobs', 'job.get': 'job', 'job.update': 'updateJob', 'job.set_archived': 'archiveJob',
  'profile.list_items': 'profileItems', 'profile.create': 'createProfile', 'profile.update': 'updateProfile',
  'profile.add_item': 'addProfileItem', 'profile.update_item': 'updateProfileItem', 'profile.add_fact': 'addProfileFact', 'profile.update_fact': 'updateProfileFact',
  'profile.list': 'profiles', 'profile.get': 'profile', 'profile.list_facts': 'facts', 'application.get': 'application',
  'application.list_events': 'events', 'application.set_status': 'setStatus', 'application.add_note': 'addNote',
  'application.schedule_event': 'schedule', 'application.reschedule_event': 'reschedule', 'artifact.get': 'artifact',
  'job.import': 'importJob', 'resume.start': 'startResume', 'resume.get_context': 'resumeContext', 'resume.list_facts': 'resumeFacts',
  'resume.submit_optimization': 'optimizeResume', 'resume.publish': 'publishResume',
  'resume.fail': 'failResume', 'resume.cancel': 'cancelResume', 'artifact.build': 'buildArtifact'
}
// Treat unknown future capabilities as writes so interruption never suggests a safe replay.
const readTools = new Set(['tool.search', 'tool.activate', 'memory.list', 'memory.read', 'memory.recall','knowledge.list','knowledge.read','knowledge.search','knowledge.retrieve','job.list', 'job.get', 'profile.list', 'profile.get', 'profile.list_facts', 'profile.list_items',
  'application.get', 'application.list_events', 'resume.get_context', 'resume.list_facts', 'artifact.get'])
export const isAskWrite = (name: string) => !readTools.has(name)
/** Compact allowlisted labels; the Host recorder separately stores redacted full details. */
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
