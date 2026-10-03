import type { JobRepository } from '../job/job.repository'
import type { ApplicationStatus } from '../job/job.types'
import type { ApplicationRepository } from './application.repository'
import type { JobEvent } from './application.types'
import type { Runtime, UnitOfWork } from '../common/ports'
import { fail } from '../common/errors'
import * as v from '../common/validation'
import { applicationStatuses } from '../job/job.types'

const transitions: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  NOT_STARTED: ['PREPARING', 'APPLIED', 'WITHDRAWN'], PREPARING: ['NOT_STARTED', 'APPLIED', 'WITHDRAWN'],
  APPLIED: ['INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'], INTERVIEW: ['OFFER', 'REJECTED', 'WITHDRAWN'],
  OFFER: ['ACCEPTED', 'REJECTED', 'WITHDRAWN'], ACCEPTED: [], REJECTED: [], WITHDRAWN: []
}
const schedule = v.object({ jobId: v.id, type: v.choice(['INTERVIEW', 'DEADLINE', 'FOLLOW_UP']), title: v.text(500, 1), description: v.optionalText(20_000), startsAt: v.timestamp, endsAt: v.optional(v.nullable(v.timestamp), null) })

export function createApplicationService(jobs: JobRepository, repo: ApplicationRepository, tx: UnitOfWork, runtime: Runtime) {
  function editableJob(id: string) { const job = jobs.get(id); if (job.archivedAt) fail('INVALID_STATE'); return job }
  function makeEvent(jobId: string, type: JobEvent['type'], title: string): JobEvent {
    return { id: runtime.id(), jobId, type, title, description: '', occurredAt: runtime.now(), startsAt: null, endsAt: null, externalSource: '', externalId: '', metadata: {} }
  }
  return {
    changeStatus(input: unknown) {
      return tx.write({ event: 'APPLICATION_STATUS_CHANGE', action: 'UPDATE', target: 'job' }, () => {
        const args = v.object({ jobId: v.id, status: v.choice(applicationStatuses) })(input)
        const job = editableJob(args.jobId)
        if (!transitions[job.applicationStatus].includes(args.status)) fail('INVALID_STATE')
        const previous = job.applicationStatus, now = runtime.now()
        job.applicationStatus = args.status
        if (args.status === 'APPLIED') job.appliedAt = now
        if (['ACCEPTED', 'REJECTED', 'WITHDRAWN'].includes(args.status)) job.closedAt = now
        job.updatedAt = now
        jobs.save(job)
        const event = makeEvent(job.id, args.status === 'APPLIED' ? 'APPLICATION_SUBMITTED' : 'STATUS_CHANGED', args.status)
        event.metadata = { fromStatus: previous, toStatus: args.status }
        repo.insertEvent(event)
        return job
      })
    },
    scheduleEvent(input: unknown) {
      return tx.write({ event: 'APPLICATION_SCHEDULE', action: 'CREATE', target: 'job_event' }, () => {
        const args = schedule(input)
        editableJob(args.jobId)
        if (args.endsAt && args.endsAt < args.startsAt) fail('INVALID_INPUT')
        const event = { ...makeEvent(args.jobId, args.type, args.title), ...args }
        repo.insertEvent(event)
        return event
      })
    },
    rescheduleEvent(input: unknown) {
      return tx.write({ event: 'APPLICATION_RESCHEDULE', action: 'UPDATE', target: 'job_event' }, () => {
        const args = v.object({ id: v.id, startsAt: v.timestamp, endsAt: v.optional(v.nullable(v.timestamp), null) })(input)
        const event = repo.getEvent(args.id)
        editableJob(event.jobId)
        if (!['INTERVIEW', 'DEADLINE', 'FOLLOW_UP'].includes(event.type)) fail('INVALID_STATE')
        if (args.endsAt && args.endsAt < args.startsAt) fail('INVALID_INPUT')
        Object.assign(event, { startsAt: args.startsAt, endsAt: args.endsAt })
        repo.saveEvent(event)
        return event
      })
    },
    addNote(input: unknown) {
      return tx.write({ event: 'APPLICATION_NOTE', action: 'CREATE', target: 'job_event' }, () => {
        const args = v.object({ jobId: v.id, text: v.text(20_000, 1) })(input)
        jobs.get(args.jobId)
        const event = { ...makeEvent(args.jobId, 'NOTE', 'NOTE'), description: args.text }
        repo.insertEvent(event)
        return event
      })
    },
    deleteEvent(input: unknown) {
      return tx.write({ event: 'APPLICATION_EVENT_DELETE', action: 'DELETE', target: 'job_event' }, () => {
        const { id } = v.byId(input), event = repo.getEvent(id)
        if (['STATUS_CHANGED', 'APPLICATION_SUBMITTED'].includes(event.type)) fail('INVALID_STATE')
        repo.removeEvent(id)
        return { id }
      })
    },
    listEvents(input: unknown) { return tx.read(() => { const args = v.object({ jobId: v.id, ...v.pageFields })(input); jobs.get(args.jobId); return repo.events(args.jobId, args.limit, args.offset) }) },
    listCalendar(input: unknown) { return tx.read(() => { const args = v.object({ from: v.timestamp, to: v.timestamp, ...v.pageFields })(input); if (args.from > args.to) fail('INVALID_INPUT'); return repo.calendar(args.from, args.to, args.limit, args.offset) }) }
  }
}
