import type { AskAgentAPI } from '../ask-agent-contract'
import type { AgentRunEvent } from '../../../domain/chat/chat.types'
import type { Result } from '../../../shared/ipc'
export function createAskAgentBridge(invoke: (method: string, input: unknown) => Promise<Result<unknown>>, subscribe: (callback: (event: AgentRunEvent) => void) => () => void): AskAgentAPI {
  return { start: input => invoke('start', input) as ReturnType<AskAgentAPI['start']>, cancel: input => invoke('cancel', input) as ReturnType<AskAgentAPI['cancel']>,
    retryMemory: input => invoke('retryMemory', input) as ReturnType<AskAgentAPI['retryMemory']>, getRun: input => invoke('getRun', input) as ReturnType<AskAgentAPI['getRun']>, listActive: input => invoke('listActive', input) as ReturnType<AskAgentAPI['listActive']>, onEvent: subscribe }
}
