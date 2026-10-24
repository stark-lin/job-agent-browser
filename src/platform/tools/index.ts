import type { composeBackend } from '../database/backend'
import { createToolRegistry } from '../../shared/tools/registry'
import { createResumeTools } from './resume'
import { createJobTools } from './job'
import { createApplicationTools } from './application'

export const jobAgentAllowlist = ['job.list', 'job.get', 'job.import', 'job.update', 'job.set_archived',
  'application.get', 'application.set_status', 'application.list_events', 'application.add_note', 'application.schedule_event', 'application.reschedule_event',
  'profile.list', 'profile.get', 'profile.list_facts', 'resume.start', 'resume.get_context', 'resume.list_facts',
  'resume.submit_scores', 'resume.submit_gate', 'resume.submit_selection', 'resume.submit_draft', 'resume.submit_polished',
  'resume.publish', 'resume.fail', 'resume.cancel', 'artifact.get', 'artifact.build'] as const

/** The sole public registry composition. ToolScope stays inside the Server boundary. */
export function createJobAgentTooling(backend: ReturnType<typeof composeBackend>, build: (id: string, signal: AbortSignal) => Promise<unknown>) {
  const registry = createToolRegistry()
  const tools = [...backend.toolCapabilities.read, backend.toolCapabilities.write.setArchived,
    ...createJobTools(backend), ...createApplicationTools(backend), ...createResumeTools(backend, build)]
  for (const tool of tools) registry.register(tool)
  return { registry, tools, dispose() { registry.dispose() } }
}
