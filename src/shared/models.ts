export type ModelState = 'missing' | 'installing' | 'verifying' | 'ready' | 'corrupted' | 'error' | 'removing'
export interface ModelStatus {
  state: ModelState; id: string; revision: string; dimensions: number; directory: string
  completed: number; total: number; error: string | null; seedAvailable: boolean
}
