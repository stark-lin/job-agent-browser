import type { ApplicationStatus } from '../job/job.types'
import type { JobDetails } from '../job/job.types'
export type EventType = 'STATUS_CHANGED' | 'APPLICATION_SUBMITTED' | 'INTERVIEW' | 'DEADLINE' | 'FOLLOW_UP' | 'NOTE'
export interface JobEvent {
  id: string; jobId: string; type: EventType; title: string; description: string
  occurredAt: string; startsAt: string | null; endsAt: string | null; externalSource: string; externalId: string
  metadata: { fromStatus?: ApplicationStatus; toStatus?: ApplicationStatus }
}
export interface ScheduleInput { jobId: string; type: 'INTERVIEW' | 'DEADLINE' | 'FOLLOW_UP'; title: string; description?: string; startsAt: string; endsAt?: string | null }
export type ApplicationAction = { type: 'set_status'; status: ApplicationStatus }
  | { type: 'add_note'; text: string }
  | { type: 'schedule_event'; eventType: ScheduleInput['type']; title: string; description: string; startsAt: string; endsAt: string | null }
  | { type: 'reschedule_event'; eventId: string; startsAt: string; endsAt: string | null }
  | { type: 'update_job'; changes: Partial<JobDetails> }
  | { type: 'set_archived'; archived: boolean }
export interface ApplicationPlan { question: string; actions: ApplicationAction[] }
