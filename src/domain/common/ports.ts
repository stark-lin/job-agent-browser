export type TargetType = 'company' | 'job' | 'job_source' | 'job_event' | 'profile' | 'profile_item' | 'fact' | 'generation_run' | 'artifact' | 'artifact_fact'
export interface Page { limit?: number; offset?: number }
export interface PageResult<T> { items: T[]; total: number }
export interface Reference { type: TargetType; id: string; status: 'ACTIVE' | 'MISSING' }
export interface UnitOfWork {
  write<T>(operation: () => T): T
  read<T>(operation: () => T): T
}
export interface Runtime { id(): string; now(): string }
export interface References { resolve(type: TargetType, id: string): Reference }
