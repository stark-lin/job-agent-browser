import type { HumanRequest } from '../../shared/human'
import type { Result } from '../../shared/ipc'
export const HUMAN_CALL = 'human:call', HUMAN_CHANGED = 'human:changed'
export interface HumanAPI {
  list(): Promise<Result<HumanRequest[]>>
  answer(id: string, selectedOption: string | null, text: string): Promise<Result<null>>
  cancel(id: string): Promise<Result<null>>
  subscribe(listener: () => void): () => void
}
