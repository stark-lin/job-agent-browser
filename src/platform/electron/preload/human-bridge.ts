import type { HumanAPI } from '../human-contract'
import type { Result } from '../../../shared/ipc'
export function createHumanBridge(invoke: (method: string, input: unknown) => Promise<Result<unknown>>, subscribe: HumanAPI['subscribe']): HumanAPI {
  return { list: () => invoke('list', {}) as ReturnType<HumanAPI['list']>,
    answer: (id, selectedOption, text) => invoke('answer', { id, selectedOption, text }) as ReturnType<HumanAPI['answer']>,
    cancel: id => invoke('cancel', { id }) as ReturnType<HumanAPI['cancel']>, subscribe }
}
