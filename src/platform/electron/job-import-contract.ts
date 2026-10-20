import type { AIChoice, AIError } from '../../shared/ai'
import type { Result } from '../../shared/ipc'
import type { JobImportDraft } from '../../domain/job/job.extractor'

export type JobImportError = AIError | 'JOB_ACCESS_RESTRICTED' | 'JOB_FETCH_FAILED' | 'JOB_FETCH_TIMEOUT'
  | 'JOB_CONTENT_TOO_LARGE' | 'JOB_NO_CONTENT' | 'JOB_INVALID_OUTPUT'
export interface JobImportTask { taskId: string }
export type JobImportEvent = JobImportTask & (
  { type: 'phase'; phase: 'reading' | 'parsing' }
  | { type: 'ready'; draft: JobImportDraft }
  | { type: 'failed'; error: JobImportError }
  | { type: 'cancelled' }
)
export interface JobImportAPI {
  start(input: { url: string; choice: AIChoice }): Promise<Result<JobImportTask, JobImportError>>
  cancel(input: JobImportTask): Promise<Result<null, JobImportError>>
  onEvent(callback: (event: JobImportEvent) => void): () => void
}
