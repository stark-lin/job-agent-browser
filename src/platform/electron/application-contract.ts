import type { Result } from '../../shared/ipc'
import type { ApplicationAction } from '../../domain/application/application.types'

export const APPLICATION_CALL = 'application-agent:call'
export interface ApplicationActionResult { type: ApplicationAction['type']; state: 'pending' | 'succeeded' | 'failed'; error: string | null }
export interface ApplicationTask {
  taskId: string; jobId: string; state: 'planning' | 'waiting' | 'executing' | 'succeeded' | 'failed' | 'cancelled'
  question: string; results: ApplicationActionResult[]; error: string | null; retryable: boolean
}
export interface ApplicationAgentAPI {
  start(input: { jobId: string; instruction: string }): Promise<Result<{ taskId: string }, string>>
  reply(input: { taskId: string; answer: string }): Promise<Result<null, string>>
  retry(input: { taskId: string }): Promise<Result<null, string>>
  getTask(input: { taskId: string }): Promise<Result<ApplicationTask, string>>
  cancel(input: { taskId: string }): Promise<Result<null, string>>
}
export const applicationAgentMethods = ['start', 'reply', 'retry', 'getTask', 'cancel'] as const
