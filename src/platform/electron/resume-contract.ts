import type { AgentRunEvent, AgentSnapshot, ChatModelRequest } from '../../domain/chat/chat.types'
import type { ReActCycle } from '../../shared/agent/react-cycle'
import type { Result } from '../../shared/ipc'
import type { Artifact, GenerationRun } from '../../domain/resume/resume.types'

export const RESUME_CALL = 'resume:call', RESUME_EVENT = 'resume:event'
export interface ResumeTask { run: GenerationRun; artifact: Artifact | null; active: boolean; owned: boolean; sequence: number }
export type ResumeEvent = { runId: string; sequence: number } & (
  { state: GenerationRun['state']; settled: boolean; artifactId: string | null; trace?: never }
  | { trace: AgentRunEvent<string | null>; state?: never; settled?: never; artifactId?: never }
)
export interface ResumeTrace extends AgentSnapshot { cycles: ReActCycle[]; requests: ChatModelRequest[] }
export interface ResumeAPI {
  start(input: { jobId: string; profileId: string }): Promise<Result<{ runId: string }>>
  getTask(input: { runId?: string }): Promise<Result<ResumeTask | null>>
  getTrace(input: { runId: string }): Promise<Result<ResumeTrace | null>>
  cancel(input: { runId: string }): Promise<Result<null>>
  retryOutput(input: { artifactId: string }): Promise<Result<null>>
  getPreview(input: { artifactId: string }): Promise<Result<{ html: string; pages: number; revision: number }>>
  exportPdf(input: { artifactId: string }): Promise<Result<{ saved: boolean }>>
  onEvent(callback: (event: ResumeEvent) => void): () => void
}
export const resumeMethods = ['start', 'getTask', 'getTrace', 'cancel', 'retryOutput', 'getPreview', 'exportPdf'] as const
