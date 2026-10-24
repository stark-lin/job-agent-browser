import type { ExternalSkillsAPI, ExternalSkillsError } from '../../../shared/external-skills'
import type { Result } from '../../../shared/ipc'

export function createExternalSkillsBridge(invoke: (method: string, input: unknown) => Promise<Result<unknown, ExternalSkillsError>>): ExternalSkillsAPI {
  return {
    inspect: input => invoke('inspect', input) as ReturnType<ExternalSkillsAPI['inspect']>,
    install: input => invoke('install', input) as ReturnType<ExternalSkillsAPI['install']>,
    openBundle: input => invoke('openBundle', input) as ReturnType<ExternalSkillsAPI['openBundle']>
  }
}
