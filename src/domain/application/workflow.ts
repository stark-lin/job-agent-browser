import type { ApplicationStatus, Job } from '../job/job.types'

export const applicationTransitions: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  NOT_STARTED: ['PREPARING', 'APPLIED', 'WITHDRAWN'], PREPARING: ['NOT_STARTED', 'APPLIED', 'WITHDRAWN'],
  APPLIED: ['INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'], INTERVIEW: ['OFFER', 'REJECTED', 'WITHDRAWN'],
  OFFER: ['ACCEPTED', 'REJECTED', 'WITHDRAWN'], ACCEPTED: [], REJECTED: [], WITHDRAWN: []
}
export const terminalApplicationStatuses: readonly ApplicationStatus[] = ['ACCEPTED', 'REJECTED', 'WITHDRAWN']
export function allowedNextStatuses(job: Job): readonly ApplicationStatus[] {
  return job.archivedAt ? [] : applicationTransitions[job.applicationStatus]
}
export function applicationState(job: Job) {
  return { jobId: job.id, status: job.applicationStatus, allowedNextStatuses: [...allowedNextStatuses(job)],
    appliedAt: job.appliedAt, closedAt: job.closedAt, archived: Boolean(job.archivedAt), updatedAt: job.updatedAt }
}
