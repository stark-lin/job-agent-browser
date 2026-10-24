import type { ApplicationAgentAPI } from '../application-contract'
import type { Result } from '../../../shared/ipc'

export function createApplicationBridge(invoke: (method: string, input: unknown) => Promise<Result<unknown, string>>): ApplicationAgentAPI {
  return {
    start: input => invoke('start', input) as ReturnType<ApplicationAgentAPI['start']>,
    reply: input => invoke('reply', input) as ReturnType<ApplicationAgentAPI['reply']>,
    retry: input => invoke('retry', input) as ReturnType<ApplicationAgentAPI['retry']>,
    getTask: input => invoke('getTask', input) as ReturnType<ApplicationAgentAPI['getTask']>,
    cancel: input => invoke('cancel', input) as ReturnType<ApplicationAgentAPI['cancel']>
  }
}
