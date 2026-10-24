import type { ImportMode, ImportGroupProgress } from '../../shared/import'
import type { AIChoice, AIError } from '../../shared/ai'
import type { Result } from '../../shared/ipc'
import type { AgentErrorCode } from '../../shared/agent'
import type { JobImportDraft } from '../../domain/job/job.extractor'
import type { Job, JobInput, SourceInput } from '../../domain/job/job.types'
import type { PdfSelection, ImportError } from './profile-import-contract'

export type JobImportError = AIError | AgentErrorCode | ImportError | 'FORBIDDEN' | 'INVALID_INPUT' | 'STORAGE_UNAVAILABLE' | 'JOB_ACCESS_RESTRICTED' | 'JOB_FETCH_FAILED' | 'JOB_FETCH_TIMEOUT'
  | 'JOB_CONTENT_TOO_LARGE' | 'JOB_NO_CONTENT' | 'JOB_INVALID_OUTPUT'
export interface JobImportTask { taskId: string }
export type CaptureInput = ({ url: string } | { text: string } | { fileId: string }) & { choice: AIChoice; mode?: ImportMode }
export interface CaptureSave extends JobImportTask { details: JobInput; source?: SourceInput | null }
export interface CaptureTaskView extends JobImportTask { state: 'running' | 'failed' | 'ready' | 'saving' | 'saved'; draft: JobImportDraft | null }
export type JobImportEvent = JobImportTask & (
  { type: 'phase'; phase: 'reading' | 'parsing' }
  | { type: 'progress'; groups: ImportGroupProgress[] }
  | { type: 'ready'; draft: JobImportDraft }
  | { type: 'failed'; error: JobImportError; retryable?: boolean }
  | { type: 'cancelled' }
)
export interface JobImportAPI {
  selectPdf(): Promise<Result<PdfSelection | null, JobImportError>>
  start(input: CaptureInput): Promise<Result<JobImportTask, JobImportError>>
  save(input: CaptureSave): Promise<Result<Job, string>>
  getTask(input: JobImportTask): Promise<Result<CaptureTaskView, string>>
  retry(input: JobImportTask): Promise<Result<JobImportTask, JobImportError>>
  cancel(input: JobImportTask): Promise<Result<null, JobImportError>>
  onEvent(callback: (event: JobImportEvent) => void): () => void
}
