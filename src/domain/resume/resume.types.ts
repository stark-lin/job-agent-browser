import type { Contact, Fact, Profile, ProfileItem } from '../candidate/candidate.types'
import type { Job } from '../job/job.types'
import type { Reference } from '../common/ports'

export const runStatuses = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'] as const
export type RunStatus = typeof runStatuses[number]
export interface GenerationConfig { templateId: string; targetWordCount: number }
export interface InputSnapshot { schemaVersion: 1; job: Job; profile: Profile; items: ProfileItem[]; facts: Fact[] }
export interface ContentBlock { id: string; text: string }
export interface ResumeContent {
  schemaVersion: 1; header: Contact; summary: ContentBlock | null
  sections: { id: string; title: string; items: { id: string; profileItemId: string | null; title: string; subtitle: string; dateRange: string; blocks: ContentBlock[] }[] }[]
}
export interface Score { factId: string; score: number; reason: string }
export interface Gate { passed: boolean; reason: string; missingRequirements: string[] }
export interface Selection { factIds: string[]; itemIds: string[]; wordBudget: number }
export interface GenerationRun {
  id: string; jobId: string; type: 'RESUME'; status: RunStatus; inputSnapshot: InputSnapshot
  scores: Score[] | null; gate: Gate | null; selection: Selection | null; draft: ResumeContent | null; polished: ResumeContent | null
  config: GenerationConfig; error: string | null; createdAt: string; updatedAt: string; finishedAt: string | null
}
export interface Provenance { blockId: string; factIds: string[] }
export interface OutputFile { format: 'PDF' | 'DOCX'; relativePath: string }
export interface Artifact {
  id: string; generationRunId: string; type: 'RESUME'; title: string; content: ResumeContent
  templateId: string; outputFiles: OutputFile[]; createdAt: string; updatedAt: string
}
export interface ArtifactFact { artifactId: string; blockId: string; factId: string }
export interface ArtifactView { artifact: Artifact; provenance: Provenance[]; references: Reference[] }
export interface RunView { run: GenerationRun; references: Reference[] }
export interface CreateRunInput { jobId: string; profileId: string; factIds: string[]; itemIds?: string[]; config?: Partial<GenerationConfig> }
