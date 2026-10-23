import type { Contact, Fact, Profile, ProfileItem } from '../candidate/candidate.types'
import type { Job } from '../job/job.types'
import type { Reference } from '../common/ports'

export const runStatuses = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'] as const
export type RunStatus = typeof runStatuses[number]
export type ResumeLanguage = 'en' | 'zh-CN'
export type GenerationStage = 'snapshot' | 'score' | 'gate' | 'select' | 'draft' | 'validate-draft' | 'polish' | 'validate-polish' | 'publish' | 'output' | 'completed'
export interface GenerationConfig { templateId: 'default-v1'; targetWordCount: number; providerId: string; modelId: string; runtimeKind?: 'internal' | 'external' }
export interface InputSnapshot { schemaVersion: 1; job: Job; profile: Profile; items: ProfileItem[]; facts: Fact[] }
export interface ResumeStatement { id: string; text: string; factIds: string[] }
export interface ResumeEntry {
  profileItemId: string; title: string; organization: string; role: string; location: string
  startDate: string; endDate: string; isCurrent: boolean; degree: string; major: string; gpa: string; url: string
  bullets: ResumeStatement[]
}
export interface ResumeDocument {
  schemaVersion: 1; language: ResumeLanguage; basics: Contact; summary: ResumeStatement | null
  experience: ResumeEntry[]; projects: ResumeEntry[]; education: ResumeEntry[]; skills: ResumeStatement[]
}
/** Model output intentionally excludes all application-owned basic information. */
export interface ResumeWriting {
  summary: ResumeStatement | null; experience: Pick<ResumeEntry, 'profileItemId' | 'bullets'>[]
  projects: Pick<ResumeEntry, 'profileItemId' | 'bullets'>[]; education: Pick<ResumeEntry, 'profileItemId' | 'bullets'>[]; skills: ResumeStatement[]
}
export interface Score { factId: string; score: number; reason: string }
export interface Gate { passed: boolean; reason: string; missingRequirements: string[] }
export interface Selection { factIds: string[]; itemIds: string[]; wordBudget: number }
export interface GenerationRun {
  id: string; jobId: string; type: 'RESUME'; status: RunStatus; stage: GenerationStage; language: ResumeLanguage | null; inputSnapshot: InputSnapshot
  scores: Score[] | null; gate: Gate | null; selection: Selection | null; draft: ResumeDocument | null; polished: ResumeDocument | null
  config: GenerationConfig; error: string | null; createdAt: string; updatedAt: string; finishedAt: string | null
}
export interface Provenance { blockId: string; factIds: string[] }
export interface OutputFile { format: 'HTML' | 'PDF'; relativePath: string }
export interface OutputState { status: 'PENDING' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED'; error: string | null; pages: number | null }
export interface Artifact {
  id: string; generationRunId: string; type: 'RESUME'; title: string; content: ResumeDocument
  templateId: string; outputFiles: OutputFile[]; output: OutputState; createdAt: string; updatedAt: string
}
export interface ArtifactFact { artifactId: string; blockId: string; factId: string }
export interface ArtifactView { artifact: Artifact; provenance: Provenance[]; references: Reference[] }
export interface RunView { run: GenerationRun; references: Reference[] }
export interface CreateRunInput { jobId: string; profileId: string; config?: Partial<GenerationConfig> }
