import type { JobDetails, SourceDetails } from './job.types'

/** A URL reader and a future Browser capture adapter produce the same plain data. */
export interface JobPageSnapshot {
  requestedUrl: string
  url: string
  pageTitle: string
  cleanedContent: string
  jobPosting: unknown[]
}
export type JobDraft = Omit<JobDetails, 'companyId'>
export interface JobImportDraft { details: JobDraft; source: SourceDetails | null }
export interface JobPageReader { read(url: string, signal: AbortSignal): Promise<JobPageSnapshot> }
export interface JobExtractor { extract(snapshot: JobPageSnapshot, signal: AbortSignal): Promise<JobDraft> }
