import type { ResumeRepository } from './resume.repository'
import type { References, Runtime, UnitOfWork } from '../common/ports'
import * as v from '../common/validation'
import * as check from './resume.validation'
import { snapshotReferences } from './references'

export function createArtifactService(repo: ResumeRepository, tx: UnitOfWork, runtime: Runtime, refs: References) {
  return {
    getArtifact(input: unknown) { return tx.read(() => {
      const artifact = repo.getArtifact(v.byId(input).id), run = repo.getRun(artifact.generationRunId)
      const grouped = new Map<string, string[]>()
      for (const link of repo.links(artifact.id)) grouped.set(link.blockId, [...(grouped.get(link.blockId) ?? []), link.factId])
      return { artifact, provenance: [...grouped].map(([blockId, factIds]) => ({ blockId, factIds })), references: snapshotReferences(run.inputSnapshot, refs) }
    }) },
    editArtifact(input: unknown) {
      return tx.write({ event: 'ARTIFACT_EDIT', action: 'UPDATE', target: 'artifact' }, () => {
        const args = v.object({ id: v.id, title: v.text(500, 1), content: check.content, provenance: check.provenance })(input)
        const artifact = repo.getArtifact(args.id), run = repo.getRun(artifact.generationRunId)
        check.validateContent(run, args.content, args.provenance)
        Object.assign(artifact, { title: args.title, content: args.content, updatedAt: runtime.now(), outputFiles: [] })
        repo.saveArtifact(artifact)
        repo.replaceLinks(artifact.id, args.provenance.flatMap((link) => link.factIds.map((factId) => ({ artifactId: artifact.id, blockId: link.blockId, factId }))))
        return artifact
      })
    },
    deleteArtifact(input: unknown) {
      return tx.write({ event: 'ARTIFACT_DELETE', action: 'DELETE', target: 'artifact' }, () => { const { id } = v.byId(input); repo.getArtifact(id); repo.removeArtifact(id); return { id } })
    }
  }
}
