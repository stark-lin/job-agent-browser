import type { Result } from '../../shared/ipc'
import type { Artifact, GenerationRun, GenerationStage } from '../../domain/resume/resume.types'

export const RESUME_CALL = 'resume:call', RESUME_EVENT = 'resume:event'
export interface ResumeTask { run: GenerationRun; artifact: Artifact | null; active: boolean; owned: boolean; sequence: number }
export interface ResumeEvent { runId: string; sequence: number; stage: GenerationStage; status: GenerationRun['status']; artifactId: string | null }
export interface ResumeAPI {
  start(input: { jobId: string; profileId: string }): Promise<Result<{ runId: string }>>
  getTask(input: { runId?: string }): Promise<Result<ResumeTask | null>>
  cancel(input: { runId: string }): Promise<Result<null>>
  retryOutput(input: { artifactId: string }): Promise<Result<null>>
  getPreview(input: { artifactId: string }): Promise<Result<{ html: string; pages: number }>>
  exportPdf(input: { artifactId: string }): Promise<Result<{ saved: boolean }>>
  onEvent(callback: (event: ResumeEvent) => void): () => void
}
export const resumeMethods = ['start', 'getTask', 'cancel', 'retryOutput', 'getPreview', 'exportPdf'] as const
