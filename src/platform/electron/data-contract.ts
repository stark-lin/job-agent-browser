import type { ChatSession, ChatRun, ChatItem } from '../../domain/chat/chat.types'
import type { Result } from '../../shared/ipc'
import type { Preferences, PreferencePatch } from '../../shared/settings'
import type { ErrorCode } from '../../domain/common/errors'
import type { AuditEntry, AuditFilter, Page, PageResult } from '../../domain/common/ports'
import type { ApplicationStatus, Company, CompanyInput, Job, JobFilter, JobInput, JobSource, SourceInput } from '../../domain/job/job.types'
import type { ProfileInput, Fact, FactInput, ItemInput, Profile, ProfileItem } from '../../domain/candidate/candidate.types'
import type { ApplyImport, ImportSaved } from '../../domain/candidate/import.types'
import type { JobEvent, ScheduleInput } from '../../domain/application/application.types'
import type { Artifact, ArtifactView, CreateRunInput, GenerationRun, ResumeDocument, RunView } from '../../domain/resume/resume.types'

type Id = { id: string }
type Endpoint<I, O> = [input: I, output: O]

/** Public business capability contract. Database rows, transaction contexts and audit writers are private. */
export interface DataContract {
  chats: {
    listSessions: Endpoint<Page, PageResult<ChatSession>>
    getSession: Endpoint<Id, ChatSession>
    getRun: Endpoint<Id, ChatRun>
    listItems: Endpoint<{ sessionId: string; limit?: number; beforeSequence?: number }, PageResult<ChatItem>>
    listRuns: Endpoint<{ sessionId: string } & Page, PageResult<ChatRun>>
    renameSession: Endpoint<{ id: string; title: string }, ChatSession>
    setModel: Endpoint<{ id: string; choice: { providerId: string; modelId: string } }, ChatSession>
    deleteSession: Endpoint<Id, null>
  }
  jobs: {
    saveJob: Endpoint<{ details: JobInput; source?: SourceInput | null }, Job>
    updateDetails: Endpoint<{ id: string; details: JobInput }, Job>
    attachSource: Endpoint<{ jobId: string; source: SourceInput }, JobSource>
    setArchived: Endpoint<{ id: string; archived: boolean }, Job>
    deleteJob: Endpoint<Id, Id>
    getJob: Endpoint<Id, Job>
    listJobs: Endpoint<JobFilter, PageResult<Job>>
    listSources: Endpoint<{ jobId: string } & Page, PageResult<JobSource>>
    registerCompany: Endpoint<CompanyInput, Company>
    updateCompany: Endpoint<{ id: string; details: CompanyInput }, Company>
    deleteCompany: Endpoint<Id, Id>
    listCompanies: Endpoint<Page, PageResult<Company>>
  }
  profiles: {
    applyImport: Endpoint<ApplyImport, ImportSaved>
    createProfile: Endpoint<ProfileInput, Profile>
    editContact: Endpoint<{ id: string; details: ProfileInput }, Profile>
    deleteProfile: Endpoint<Id, Id>
    getProfile: Endpoint<Id, Profile>
    listProfiles: Endpoint<Page, PageResult<Profile>>
    addItem: Endpoint<{ profileId: string; parentItemId?: string | null; details: ItemInput }, ProfileItem>
    editItem: Endpoint<{ id: string; details: ItemInput }, ProfileItem>
    moveItem: Endpoint<{ id: string; parentItemId: string | null; sortOrder: number }, ProfileItem>
    deleteItem: Endpoint<Id, Id>
    listItems: Endpoint<{ profileId: string } & Page, PageResult<ProfileItem>>
    addFact: Endpoint<{ profileId: string; profileItemId?: string | null; details: FactInput }, Fact>
    editFact: Endpoint<{ id: string; profileItemId?: string | null; details: FactInput }, Fact>
    deleteFact: Endpoint<Id, Id>
    listFacts: Endpoint<{ profileId: string } & Page, PageResult<Fact>>
  }
  applications: {
    changeStatus: Endpoint<{ jobId: string; status: ApplicationStatus }, Job>
    scheduleEvent: Endpoint<ScheduleInput, JobEvent>
    rescheduleEvent: Endpoint<{ id: string; startsAt: string; endsAt?: string | null }, JobEvent>
    addNote: Endpoint<{ jobId: string; text: string }, JobEvent>
    deleteEvent: Endpoint<Id, Id>
    listEvents: Endpoint<{ jobId: string } & Page, PageResult<JobEvent>>
    listCalendar: Endpoint<{ from: string; to: string } & Page, PageResult<JobEvent>>
  }
  resumes: {
    createRun: Endpoint<CreateRunInput, GenerationRun>
    cancelRun: Endpoint<Id, GenerationRun>
    deleteRun: Endpoint<Id, Id>
    getRun: Endpoint<Id, RunView>
    listRuns: Endpoint<{ jobId?: string | null } & Page, PageResult<RunView>>
    getArtifact: Endpoint<Id, ArtifactView>
    editArtifact: Endpoint<{ id: string; title: string; content: ResumeDocument }, Artifact>
    deleteArtifact: Endpoint<Id, Id>
  }
  audit: { list: Endpoint<AuditFilter, PageResult<AuditEntry>> }
  settings: {
    get: Endpoint<Record<string, never>, Preferences>
    savePreferences: Endpoint<PreferencePatch, Preferences>
  }
  secrets: {
    hasProviderKey: Endpoint<{ provider: string }, { configured: boolean; available: boolean }>
    saveProviderKey: Endpoint<{ provider: string; apiKey: string }, { configured: boolean; available: boolean }>
    deleteProviderKey: Endpoint<{ provider: string }, { configured: boolean; available: boolean }>
  }
}

export type DataAPI = {
  [G in keyof DataContract]: {
    [M in keyof DataContract[G]]: DataContract[G][M] extends Endpoint<infer I, infer O> ? (input: I) => Promise<Result<O, ErrorCode>> : never
  }
}
export type ServiceContract = {
  [G in keyof DataContract]: {
    [M in keyof DataContract[G]]: DataContract[G][M] extends Endpoint<infer I, infer O> ? (input: I) => O : never
  }
}

// This is the sole allowlist used by the sandboxed bridge and Main dispatcher.
export const methodNames = {
  chats: ['listSessions', 'getSession', 'getRun', 'listItems', 'listRuns', 'renameSession', 'setModel', 'deleteSession'],
  jobs: ['saveJob', 'updateDetails', 'attachSource', 'setArchived', 'deleteJob', 'getJob', 'listJobs', 'listSources', 'registerCompany', 'updateCompany', 'deleteCompany', 'listCompanies'],
  profiles: ['createProfile', 'editContact', 'deleteProfile', 'getProfile', 'listProfiles', 'addItem', 'editItem', 'moveItem', 'deleteItem', 'listItems', 'addFact', 'editFact', 'deleteFact', 'listFacts', 'applyImport'],
  applications: ['changeStatus', 'scheduleEvent', 'rescheduleEvent', 'addNote', 'deleteEvent', 'listEvents', 'listCalendar'],
  resumes: ['createRun', 'cancelRun', 'deleteRun', 'getRun', 'listRuns', 'getArtifact', 'editArtifact', 'deleteArtifact'],
  audit: ['list'], settings: ['get', 'savePreferences'], secrets: ['hasProviderKey', 'saveProviderKey', 'deleteProviderKey']
} as const satisfies { [G in keyof DataContract]: readonly (keyof DataContract[G])[] }
