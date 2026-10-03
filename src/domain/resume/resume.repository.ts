import type { PageResult } from '../common/ports'
import type { Artifact, ArtifactFact, GenerationRun } from './resume.types'
export interface ResumeRepository {
  getRun(id: string): GenerationRun
  runs(jobId: string | null, limit: number, offset: number): PageResult<GenerationRun>
  insertRun(run: GenerationRun): void
  saveRun(run: GenerationRun): void
  removeRun(id: string): void
  running(): GenerationRun[]
  getArtifact(id: string): Artifact
  artifactForRun(runId: string): Artifact | null
  insertArtifact(artifact: Artifact): void
  saveArtifact(artifact: Artifact): void
  removeArtifact(id: string): void
  links(artifactId: string): ArtifactFact[]
  replaceLinks(artifactId: string, links: ArtifactFact[]): void
}
