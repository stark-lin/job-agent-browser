export interface KnowledgeNode {
  type: 'directory' | 'file'
  path: string
  name: string
  revision: string
  children?: KnowledgeNode[]
  readme?: string
}
export interface KnowledgeFile {
  path: string
  content: string
  revision: string
}
export interface KnowledgeChunk {
  id: string
  path: string
  fileTitle: string
  headingPath: string[]
  chunkIndex: number
  content: string
  startLine: number
  endLine: number
  contentHash: string
}
export interface KnowledgeHit extends KnowledgeChunk {
  score: number
  revision: string
}
export interface KnowledgeSearch {
  items: KnowledgeHit[]
  semantic: boolean
  total: number
}
export interface KnowledgeContext {
  sources: { path: string; startLine: number; endLine: number; content: string; revision: string }[]
  text: string
  semantic: boolean
  truncated: boolean
}
export interface BackupVersion {
  commit: string
  timestamp: string
  reason: string
  files: string[]
}
export type SyncState = 'local' | 'synced' | 'conflict' | 'failed'
export interface BackupStatus {
  dirty: boolean
  state: SyncState
  conflictBranch?: string
  error?: string
}
export type KnowledgeErrorCode =
  | 'KNOWLEDGE_INVALID_PATH'
  | 'KNOWLEDGE_CONFLICT'
  | 'KNOWLEDGE_NOT_FOUND'
  | 'KNOWLEDGE_TOO_LARGE'
  | 'KNOWLEDGE_BUSY'
  | 'KNOWLEDGE_UNAVAILABLE'
  | 'KNOWLEDGE_RECOVERY_REQUIRED'
  | 'KNOWLEDGE_UNSUPPORTED_FILE'
export class KnowledgeError extends Error {
  constructor(readonly code: KnowledgeErrorCode) {
    super(code)
  }
}
