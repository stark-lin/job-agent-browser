import type { Contact, Fact, Profile, ProfileItem } from '../candidate/candidate.types'
import type { Job } from '../job/job.types'
import type { Reference } from '../common/ports'

export const resumeRunStates = ['CREATED', 'COPYING', 'REWRITING', 'VALIDATING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED', 'INTERRUPTED'] as const
export type ResumeRunState = typeof resumeRunStates[number]
export type ResumeLanguage = 'en' | 'zh-CN'
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
export interface GenerationRun {
  id: string; jobId: string; type: 'RESUME'; agentRunId: string | null
  state: ResumeRunState; stateVersion: number; rewriteRevision: number
  inputSnapshot: InputSnapshot; assembled: ResumeDocument | null
  config: GenerationConfig; error: string | null; createdAt: string; updatedAt: string; finishedAt: string | null
}
export interface RewriteBulletResult { runId: string; bulletId: string; rewriteRevision: number; changed: boolean }
export interface Provenance { blockId: string; factIds: string[] }
export interface OutputFile { format: 'HTML' | 'PDF'; relativePath: string }
export interface OutputState { status: 'PENDING' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED'; error: string | null; pages: number | null }
export interface Artifact {
  id: string; generationRunId: string; type: 'RESUME'; title: string; content: ResumeDocument
  revision: number; templateId: string; outputFiles: OutputFile[]; output: OutputState; createdAt: string; updatedAt: string
}
export interface ArtifactFact { artifactId: string; blockId: string; factId: string }
export interface ArtifactView { artifact: Artifact; provenance: Provenance[]; references: Reference[] }
export interface RunView { run: GenerationRun; references: Reference[] }
export interface CreateRunInput { jobId: string; profileId: string; config?: Partial<GenerationConfig> }
