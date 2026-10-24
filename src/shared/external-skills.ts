import type { Result } from './ipc'
import type { ExternalMCPTarget } from './external-mcp'

export const EXTERNAL_SKILLS_CALL = 'external-skills:call'
export const externalSkillNames = ['capture-job', 'manage-applications', 'tailor-resume'] as const
export type ExternalSkillName = typeof externalSkillNames[number]
export type ExternalSkillState = 'missing' | 'installed' | 'different' | 'unavailable'
export const externalSkillsErrors = ['INVALID_INPUT', 'FORBIDDEN', 'SKILLS_UNAVAILABLE', 'SKILLS_CHANGED',
  'REPLACE_REQUIRED', 'INSTALL_FAILED', 'OPEN_FAILED'] as const
export type ExternalSkillsError = typeof externalSkillsErrors[number]
export interface ExternalSkillStatus { name: ExternalSkillName; state: ExternalSkillState }
export interface ExternalSkillsStatus {
  target: ExternalMCPTarget
  path: string
  revision: string
  skills: ExternalSkillStatus[]
  error?: ExternalSkillsError
}
export interface ExternalSkillsInspection { clients: ExternalSkillsStatus[] }
export interface ExternalSkillsInstall { target: ExternalMCPTarget; revision: string; replace: boolean }
export interface ExternalSkillsOutcome {
  status: ExternalSkillsStatus
  completed: ExternalSkillName[]
  pending: ExternalSkillName[]
  error?: ExternalSkillsError
}
export interface ExternalSkillsAPI {
  inspect(input: Record<string, never>): Promise<Result<ExternalSkillsInspection, ExternalSkillsError>>
  install(input: ExternalSkillsInstall): Promise<Result<ExternalSkillsOutcome, ExternalSkillsError>>
  openBundle(input: Record<string, never>): Promise<Result<null, ExternalSkillsError>>
}
