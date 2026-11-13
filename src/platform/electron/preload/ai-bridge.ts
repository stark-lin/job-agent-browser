import type { AIAPI, AIError, AIEvent } from '../../../shared/ai'
import type { Result } from '../../../shared/ipc'

export function createAIBridge(
  invoke: (operation: 'start' | 'cancel' | 'models' | 'saveConnection', input: unknown) => Promise<Result<unknown, AIError>>,
  subscribe: (callback: (event: AIEvent) => void) => () => void
): AIAPI {
  return {
    listModels: input => invoke('models', input) as ReturnType<AIAPI['listModels']>,
    saveConnection: input => invoke('saveConnection', input) as ReturnType<AIAPI['saveConnection']>,
    start: input => invoke('start', input) as ReturnType<AIAPI['start']>,
    cancel: input => invoke('cancel', input) as ReturnType<AIAPI['cancel']>,
    onEvent: subscribe
  }
}
