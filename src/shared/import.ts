export type ImportMode = 'single' | 'parallel'
export type ImportGroup = 'single' | 'basics' | 'description' | 'requirements' | 'contact' | 'experience' | 'projects' | 'education'
export interface ImportGroupProgress {
  id: ImportGroup
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  queueMs: number
  elapsedMs: number
  error?: string
}
