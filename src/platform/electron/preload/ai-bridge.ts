import type { AIAPI, AIError, AIEvent } from '../../../shared/ai'
import type { Result } from '../../../shared/ipc'

export function createAIBridge(
  invoke: (operation: 'start' | 'cancel' | 'models', input: unknown) => Promise<Result<unknown, AIError>>,
  subscribe: (callback: (event: AIEvent) => void) => () => void
): AIAPI {
  return {
    listModels: input => invoke('models', input) as ReturnType<AIAPI['listModels']>,
    start: input => invoke('start', input) as ReturnType<AIAPI['start']>,
    cancel: input => invoke('cancel', input) as ReturnType<AIAPI['cancel']>,
    onEvent: subscribe
  }
}
