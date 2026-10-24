import type { Result } from '../../shared/ipc'
import type { ChatSnapshot, ChatStart, AgentRunEvent } from '../../domain/chat/chat.types'
export const ASK_AGENT_CALL = 'ask-agent:call', ASK_AGENT_EVENT = 'ask-agent:event'
export const askAgentMethods = ['start', 'cancel', 'getRun', 'listActive'] as const
export interface AskAgentAPI {
  start(input: ChatStart): Promise<Result<{ sessionId: string; runId: string }>>
  cancel(input: { runId: string }): Promise<Result<null>>
  getRun(input: { runId: string }): Promise<Result<ChatSnapshot>>
  listActive(input: Record<string, never>): Promise<Result<ChatSnapshot[]>>
  onEvent(callback: (event: AgentRunEvent) => void): () => void
}
