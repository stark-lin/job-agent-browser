import type { ModelStatus } from '../../shared/models'
import type { Result } from '../../shared/ipc'
import type { KnowledgePreferences } from '../../shared/knowledge-settings'
import type {
  KnowledgeNode,
  KnowledgeFile,
  KnowledgeSearch,
  KnowledgeContext,
  BackupVersion,
  BackupStatus
} from '../../domain/knowledge'
export interface KnowledgeMethods {
  modelStatus: { input: Record<string, never>; output: ModelStatus }
  modelInstall: { input: { source: 'download' | 'seed' }; output: null }
  modelCancel: { input: Record<string, never>; output: null }
  modelVerify: { input: Record<string, never>; output: ModelStatus }
  modelRemove: { input: Record<string, never>; output: null }
  tree: { input: Record<string, never>; output: KnowledgeNode }
  read: { input: { path: string }; output: KnowledgeFile }
  write: { input: { path: string; content: string; expectedRevision: string | null }; output: KnowledgeFile }
  mkdir: { input: { path: string }; output: KnowledgeNode }
  move: { input: { source: string; target: string; expectedRevision: string }; output: KnowledgeNode }
  delete: { input: { path: string; expectedRevision: string; recursive: boolean }; output: null }
  search: { input: { query: string; limit?: number }; output: KnowledgeSearch }
  retrieve: { input: { query: string; maxContext?: number }; output: KnowledgeContext }
  history: { input: { offset?: number; limit?: number }; output: BackupVersion[] }
  status: { input: Record<string, never>; output: BackupStatus }
  backup: { input: Record<string, never>; output: string }
  restore: { input: { commit: string; expectedRevision: string }; output: null }
  sync: { input: Record<string, never>; output: BackupStatus }
  rebuild: { input: Record<string, never>; output: null }
  view: { input: { mode: KnowledgePreferences['mode']; explorerWidth: number }; output: KnowledgePreferences }
  configure: { input: KnowledgePreferences; output: KnowledgePreferences }
  configuration: {
    input: Record<string, never>
    output: { preferences: KnowledgePreferences; tokenConfigured: boolean; indexError: string | null }
  }
  token: { input: { token: string | null }; output: { configured: boolean } }
}
export const knowledgeMethods = [
  'modelStatus', 'modelInstall', 'modelCancel', 'modelVerify', 'modelRemove',
  'tree',
  'read',
  'write',
  'mkdir',
  'move',
  'delete',
  'search',
  'retrieve',
  'history',
  'status',
  'backup',
  'restore',
  'sync',
  'rebuild',
  'view',
  'configure',
  'configuration',
  'token'
] as const
export type KnowledgeAPI = {
  [K in keyof KnowledgeMethods]: (input: KnowledgeMethods[K]['input']) => Promise<Result<KnowledgeMethods[K]['output']>>
} & { onChanged(callback: () => void): () => void; onFlush(callback: () => Promise<boolean>): () => void }
export const KNOWLEDGE_CALL = 'knowledge:call',
  KNOWLEDGE_CHANGED = 'knowledge:changed'

export const KNOWLEDGE_FLUSH = 'knowledge:flush',
  KNOWLEDGE_FLUSHED = 'knowledge:flushed'
