import type { ErrorCode } from './errors'

export type TargetType = 'company' | 'job' | 'job_source' | 'job_event' | 'profile' | 'profile_item' | 'fact' | 'generation_run' | 'artifact' | 'artifact_fact'
export interface Page { limit?: number; offset?: number }
export interface PageResult<T> { items: T[]; total: number }
export interface Reference { type: TargetType; id: string; status: 'ACTIVE' | 'DELETED'; deletedAt: string | null }
export interface Command { event: string; action: 'CREATE' | 'UPDATE' | 'DELETE'; target: TargetType; targetId?: string }
export interface UnitOfWork {
  write<T>(command: Command, operation: () => T): T
  read<T>(operation: () => T): T
}
export interface Runtime { id(): string; now(): string }
export interface References { resolve(type: TargetType, id: string): Reference }
export interface AuditEntry {
  id: string; sequence: number; eventType: string; action: 'CREATE' | 'UPDATE' | 'DELETE'
  timestamp: string; component: string; location: string; source: string; requestId: string
  status: 'SUCCESS' | 'FAILURE'; error: ErrorCode | null; actorId: string
  targetType: TargetType; targetId: string | null; transactionId: string
}
export interface AuditFilter extends Page {
  targetType?: TargetType; targetId?: string; requestId?: string; transactionId?: string
  status?: 'SUCCESS' | 'FAILURE'; from?: string; to?: string
}
export interface AuditReader { list(input: unknown): PageResult<AuditEntry> }
