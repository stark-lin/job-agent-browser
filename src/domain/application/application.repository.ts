import type { PageResult } from '../common/ports'
import type { JobEvent } from './application.types'
export interface ApplicationRepository {
  getEvent(id: string): JobEvent
  insertEvent(event: JobEvent): void
  saveEvent(event: JobEvent): void
  removeEvent(id: string): void
  events(jobId: string, limit: number, offset: number): PageResult<JobEvent>
  calendar(from: string, to: string, limit: number, offset: number): PageResult<JobEvent>
}
