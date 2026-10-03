import type { ApplicationStatus } from '../job/job.types'
export type EventType = 'STATUS_CHANGED' | 'APPLICATION_SUBMITTED' | 'INTERVIEW' | 'DEADLINE' | 'FOLLOW_UP' | 'NOTE'
export interface JobEvent {
  id: string; jobId: string; type: EventType; title: string; description: string
  occurredAt: string; startsAt: string | null; endsAt: string | null; externalSource: string; externalId: string
  metadata: { fromStatus?: ApplicationStatus; toStatus?: ApplicationStatus }
}
export interface ScheduleInput { jobId: string; type: 'INTERVIEW' | 'DEADLINE' | 'FOLLOW_UP'; title: string; description?: string; startsAt: string; endsAt?: string | null }
