import type { PageResult } from '../common/ports'
import type { Artifact, ArtifactFact, GenerationRun, RewriteBulletResult } from './resume.types'
export interface ResumeRepository {
  getRun(id: string): GenerationRun
  runs(jobId: string | null, limit: number, offset: number): PageResult<GenerationRun>
  insertRun(run: GenerationRun): void
  requestRun(requestId: string, input: string): GenerationRun | null
  recordRequest(requestId: string, input: string, runId: string): void
  assertGeneration(id: string): void
  rewriteReceipt(runId: string, requestId: string): { hash: string; legacyExpectedRevision: number | null; result: RewriteBulletResult } | null
  rewrittenBulletIds(runId: string): string[]
  saveRewriteReceipt(requestId: string, hash: string, result: RewriteBulletResult): void
  attachAgent(run: GenerationRun, agentRunId: string, requestId: string, ownerRuntimeId: string): void
  completedAgent(agentRunId: string): boolean
  saveRun(run: GenerationRun): void
  removeRun(id: string): void
  running(): GenerationRun[]
  getArtifact(id: string): Artifact
  assertArtifactEditable(id: string): void
  artifactForRun(runId: string): Artifact | null
  insertArtifact(artifact: Artifact): void
  saveArtifact(artifact: Artifact): void
  removeArtifact(id: string): void
  links(artifactId: string): ArtifactFact[]
  replaceLinks(artifactId: string, links: ArtifactFact[]): void
}
