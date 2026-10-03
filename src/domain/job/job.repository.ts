import type { PageResult } from '../common/ports'
import type { Company, Job, JobSource } from './job.types'
import type { Parsed } from '../common/validation'
import type { jobFilter } from './job.validation'

export interface JobRepository {
  get(id: string): Job
  list(filter: Parsed<typeof jobFilter>): PageResult<Job>
  insert(job: Job): void
  save(job: Job): void
  remove(id: string): void
  getCompany(id: string): Company
  companies(limit: number, offset: number): PageResult<Company>
  insertCompany(company: Company): void
  saveCompany(company: Company): void
  removeCompany(id: string): void
  sources(jobId: string, limit: number, offset: number): PageResult<JobSource>
  insertSource(source: JobSource): void
}
