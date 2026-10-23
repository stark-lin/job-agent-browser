import type { ImportMode, ImportGroupProgress } from '../../shared/import'
import type { AIChoice, AIError } from '../../shared/ai'
import type { Result } from '../../shared/ipc'
import type { JobImportDraft } from '../../domain/job/job.extractor'

export type JobImportError = AIError | 'JOB_ACCESS_RESTRICTED' | 'JOB_FETCH_FAILED' | 'JOB_FETCH_TIMEOUT'
  | 'JOB_CONTENT_TOO_LARGE' | 'JOB_NO_CONTENT' | 'JOB_INVALID_OUTPUT'
export interface JobImportTask { taskId: string }
export type JobImportEvent = JobImportTask & (
  { type: 'phase'; phase: 'reading' | 'parsing' }
  | { type: 'progress'; groups: ImportGroupProgress[] }
  | { type: 'ready'; draft: JobImportDraft }
  | { type: 'failed'; error: JobImportError; retryable?: boolean }
  | { type: 'cancelled' }
)
export interface JobImportAPI {
  start(input: { url: string; choice: AIChoice; mode?: ImportMode }): Promise<Result<JobImportTask, JobImportError>>
  retry(input: JobImportTask): Promise<Result<JobImportTask, JobImportError>>
  cancel(input: JobImportTask): Promise<Result<null, JobImportError>>
  onEvent(callback: (event: JobImportEvent) => void): () => void
}
