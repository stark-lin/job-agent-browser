import type { ResumeRepository } from './resume.repository'
import type { Runtime, UnitOfWork } from '../common/ports'
import type { Artifact, GenerationRun } from './resume.types'
import { fail } from '../common/errors'
import * as v from '../common/validation'
import * as check from './resume.validation'
import { bulletSections, documentProvenance } from './document'
import { isGenerating, transition } from './state-machine'

/** Trusted persistence steps. They perform no AI/network work and are never exposed over IPC. */
export function createGenerationService(repo: ResumeRepository, tx: UnitOfWork, runtime: Runtime, fingerprint: (input: string) => string) {
  function advance(run: GenerationRun, state: GenerationRun['state'], error?: string) {
    transition(run, state, runtime.now(), error)
    repo.saveRun(run)
    return run
  }
  function owned(id: string) { repo.assertGeneration(id); return repo.getRun(id) }
  return {
    attachAgent(input: { runId: string; requestId: string; ownerRuntimeId: string }) {
      return tx.write({ event: 'GENERATION_AGENT_ATTACH', action: 'UPDATE', target: 'generation_run' }, () => {
        const run = owned(input.runId)
        if (run.config.runtimeKind !== 'internal' || run.state !== 'REWRITING') fail('INVALID_STATE')
        if (run.agentRunId) return { agentRunId: run.agentRunId }
        const agentRunId = runtime.id()
        repo.attachAgent(run, agentRunId, input.requestId, input.ownerRuntimeId)
        run.agentRunId = agentRunId
        run.updatedAt = runtime.now()
        repo.saveRun(run)
        return { agentRunId }
      })
    },
    rewriteBullet(input: unknown) {
      return tx.write({ event: 'GENERATION_REWRITE_BULLET', action: 'UPDATE', target: 'generation_run' }, () => {
        const args = v.object({ runId: v.id, bulletId: v.id, text: check.bulletText, requestId: v.id })(input)
        const run = owned(args.runId)
        const hash = fingerprint(JSON.stringify([args.bulletId, args.text]))
        const receipt = repo.rewriteReceipt(run.id, args.requestId)
        if (receipt) {
          const expectedHash = receipt.legacyExpectedRevision === null ? hash
            : fingerprint(JSON.stringify([args.bulletId, args.text, receipt.legacyExpectedRevision]))
          if (receipt.hash !== expectedHash) fail('CONFLICT')
          return receipt.result
        }
        if (run.state !== 'REWRITING' || !run.assembled || repo.rewrittenBulletIds(run.id).includes(args.bulletId)) fail('CONFLICT')
        const bullet = bulletSections.flatMap(section => run.assembled![section].flatMap(entry => entry.bullets)).find(value => value.id === args.bulletId)
        if (!bullet) fail('INVALID_INPUT')
        const changed = bullet.text !== args.text
        if (changed) {
          bullet.text = args.text
          check.validateGeneratedResume(run, run.assembled)
          run.updatedAt = runtime.now()
          repo.saveRun(run)
        }
        const result = { runId: run.id, bulletId: bullet.id, changed }
        repo.saveRewriteReceipt(args.requestId, hash, result)
        return result
      })
    },
    beginValidation(runId: string) {
      return tx.write({ event: 'GENERATION_VALIDATE', action: 'UPDATE', target: 'generation_run' }, () => {
        const run = owned(runId)
        if (['VALIDATING', 'PUBLISHING', 'PUBLISHED'].includes(run.state)) return run
        if (run.config.runtimeKind === 'internal' && (!run.agentRunId || !repo.completedAgent(run.agentRunId))) fail('INVALID_STATE')
        return advance(run, 'VALIDATING')
      })
    },
    preparePublication(runId: string) {
      return tx.write({ event: 'GENERATION_PREPARE_PUBLICATION', action: 'UPDATE', target: 'generation_run' }, () => {
        const run = owned(runId)
        if (run.state === 'PUBLISHING' || run.state === 'PUBLISHED') return run
        if (run.state !== 'VALIDATING' || !run.assembled) fail('INVALID_STATE')
        check.validateGeneratedResume(run, run.assembled)
        return advance(run, 'PUBLISHING')
      })
    },
    publishArtifact(input: { runId: string }) {
      return tx.write({ event: 'GENERATION_PUBLISH', action: 'CREATE', target: 'artifact' }, () => {
        const run = owned(input.runId)
        const previous = repo.artifactForRun(run.id)
        if (run.state === 'PUBLISHED' && previous) return previous
        if (run.state !== 'PUBLISHING' || !run.assembled || previous) fail('INVALID_STATE')
        const now = runtime.now(), { profile, job } = run.inputSnapshot
        const artifact: Artifact = { id: runtime.id(), generationRunId: run.id, type: 'RESUME', title: `${profile.name} — ${job.title}`.slice(0, 500),
          content: run.assembled, revision: 1, templateId: run.config.templateId, outputFiles: [],
          output: { status: 'PENDING', error: null, pages: null }, createdAt: now, updatedAt: now }
        repo.insertArtifact(artifact)
        repo.replaceLinks(artifact.id, documentProvenance(run.assembled).flatMap(link => link.factIds.map(factId => ({ artifactId: artifact.id, blockId: link.blockId, factId }))))
        advance(run, 'PUBLISHED')
        return artifact
      })
    },
    commitOutput(id: string, revision: number, output: Artifact['output'], files: Artifact['outputFiles'], guard: () => void) {
      return tx.write({ event: 'ARTIFACT_OUTPUT_STATE', action: 'UPDATE', target: 'artifact' }, () => {
        guard()
        const artifact = repo.getArtifact(id)
        if (artifact.revision !== revision) fail('CONFLICT')
        artifact.output = check.outputState(output)
        artifact.outputFiles = check.outputFiles(files)
        artifact.updatedAt = runtime.now()
        repo.saveArtifact(artifact)
        return artifact
      })
    },
    recordOutputFiles(input: unknown) {
      return tx.write({ event: 'ARTIFACT_OUTPUT_RECORD', action: 'UPDATE', target: 'artifact' }, () => {
        const args = v.object({ id: v.id, files: check.outputFiles })(input), artifact = repo.getArtifact(args.id)
        v.unique(args.files.map((file) => file.format))
        if (args.files.some((file) => !file.relativePath.endsWith(`.${file.format.toLowerCase()}`))) fail('INVALID_INPUT')
        artifact.outputFiles = args.files; artifact.updatedAt = runtime.now()
        repo.saveArtifact(artifact)
        return artifact
      })
    },
    recordOutputState(input: unknown) {
      return tx.write({ event: 'ARTIFACT_OUTPUT_STATE', action: 'UPDATE', target: 'artifact' }, () => {
        const args = v.object({ id: v.id, output: check.outputState })(input), artifact = repo.getArtifact(args.id)
        artifact.output = args.output; artifact.updatedAt = runtime.now()
        repo.saveArtifact(artifact)
        return artifact
      })
    },
    settle(id: string, state: 'FAILED' | 'CANCELLED' | 'INTERRUPTED', error?: string) {
      return tx.write({ event: state === 'CANCELLED' ? 'GENERATION_CANCEL' : state === 'FAILED' ? 'GENERATION_FAIL' : 'GENERATION_INTERRUPT', action: 'UPDATE', target: 'generation_run' }, () => {
        const run = owned(id)
        return isGenerating(run.state) ? advance(run, state, error) : run
      })
    },
    recoverInterrupted() {
      return tx.write({ event: 'GENERATION_RECOVER', action: 'UPDATE', target: 'generation_run' }, () => {
        const runs = repo.running()
        for (const run of runs) advance(run, 'INTERRUPTED', 'PROCESS_INTERRUPTED')
        return runs.length
      })
    }
  }
}
