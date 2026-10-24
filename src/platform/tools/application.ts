import type { composeBackend } from '../database/backend'
import { applicationState } from '../../domain/application/workflow'
import { businessTool } from './business'
import { applicationSchemas as schemas } from './business-schema'

export function createApplicationTools(backend: ReturnType<typeof composeBackend>) {
  return [
    businessTool(backend, 'application.get', 'Read current application state and allowed next statuses before deciding a change.', schemas.get, false, input => backend.applications.getState(input), 'jobId'),
    businessTool(backend, 'application.set_status', 'Apply a legal status transition. Same-state retries do not create events. Archived jobs cannot change status.', schemas.status, true,
      input => applicationState(backend.applications.changeStatus(input)), 'jobId'),
    businessTool(backend, 'application.list_events', 'List application events and notes, newest first. Page until the required events are found.', schemas.events, false, input => backend.applications.listEvents(input), 'jobId'),
    businessTool(backend, 'application.add_note', 'Append a note, including to an archived job. Reuse requestId only for an identical retry.', schemas.note, true,
      ({ requestId, ...input }) => backend.applications.addNote(input, String(requestId)), 'jobId'),
    businessTool(backend, 'application.schedule_event', 'Create a local interview, deadline or follow-up event. Use UTC timestamps and a stable requestId. No external calendar action.', schemas.schedule, true,
      ({ requestId, ...input }) => backend.applications.scheduleEvent(input, String(requestId)), 'jobId'),
    businessTool(backend, 'application.reschedule_event', 'Reschedule an existing local event belonging to jobId. Identical retries do not modify it again.', schemas.reschedule, true,
      input => backend.applications.rescheduleEvent(input), 'jobId')
  ]
}
