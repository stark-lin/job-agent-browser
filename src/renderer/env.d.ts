import type { AskAgentAPI } from '../platform/electron/ask-agent-contract'
import type { ExternalMCPAPI } from '../shared/external-mcp'
import type { ExternalSkillsAPI } from '../shared/external-skills'
import type { ApplicationAgentAPI } from '../platform/electron/application-contract'
import type { ResumeAPI } from '../platform/electron/resume-contract'
import type { BrowserAPI } from '../shared/browser'
import type { DataAPI } from '../platform/electron/data-contract'
import type { AIAPI } from '../shared/ai'
import type { ProfileImportAPI } from '../platform/electron/profile-import-contract'
import type { JobImportAPI } from '../platform/electron/job-import-contract'

declare global {
  interface Window {
    externalSkills: ExternalSkillsAPI
    externalMCP: ExternalMCPAPI
    askAgent: AskAgentAPI
    applicationAgent: ApplicationAgentAPI
    resume: ResumeAPI
    browser: BrowserAPI
    data: DataAPI
    ai: AIAPI
    profileImport: ProfileImportAPI
    jobImport: JobImportAPI
  }
}

export {}
