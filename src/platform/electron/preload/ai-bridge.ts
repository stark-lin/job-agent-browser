import type { AIAPI, AIError, AIEvent } from '../../../shared/ai'
import type { Result } from '../../../shared/ipc'

export function createAIBridge(
  invoke: (operation: 'start' | 'cancel', input: unknown) => Promise<Result<unknown, AIError>>,
  subscribe: (callback: (event: AIEvent) => void) => () => void
): AIAPI {
  return {
    start: input => invoke('start', input) as ReturnType<AIAPI['start']>,
    cancel: input => invoke('cancel', input) as ReturnType<AIAPI['cancel']>,
    onEvent: subscribe
  }
}
