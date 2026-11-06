import type { ResumeRepository } from './resume.repository'
import type { Runtime, UnitOfWork } from '../common/ports'
import type { Artifact, GenerationRun, ResumeDocument } from './resume.types'
import { fail } from '../common/errors'
import * as v from '../common/validation'
import * as check from './resume.validation'
import { assembleResume, documentProvenance } from './document'

/** Trusted persistence steps. They perform no AI/network work and are never exposed over IPC. */
export function createGenerationService(repo: ResumeRepository, tx: UnitOfWork, runtime: Runtime, fingerprint: (input: string) => string) {
  function running(id: string): GenerationRun {
    const run = repo.getRun(id)
    if (run.status !== 'RUNNING') fail('INVALID_STATE')
    return run
  }
  function save(run: GenerationRun) { run.updatedAt = runtime.now(); repo.saveRun(run); return run }
  return {
    start(input: unknown) {
      return tx.write({ event: 'GENERATION_START', action: 'UPDATE', target: 'generation_run' }, () => {
        const run = repo.getRun(v.byId(input).id)
        if (run.status !== 'PENDING') fail('INVALID_STATE')
        run.status = 'RUNNING'; run.stage = 'optimize'
        return save(run)
      })
    },
    submitOptimization(input: unknown, checkSize: (document: ResumeDocument) => void) {
      return tx.write({ event: 'GENERATION_OPTIMIZE', action: 'UPDATE', target: 'generation_run' }, () => {
        const args = v.object({ id: v.id, optimization: check.optimization })(input)
        const run = repo.getRun(args.id)
        const hash = fingerprint(JSON.stringify(args.optimization))
        if (run.optimizationHash) {
          if (run.optimizationHash !== hash) fail('CONFLICT')
          return run
        }
        if (run.status !== 'RUNNING' || run.stage !== 'optimize') fail('INVALID_STATE')
        const document = assembleResume(run.inputSnapshot, args.optimization, () => runtime.id())
        check.validateGeneratedResume(run, document)
        checkSize(document)
        run.assembled = document; run.optimizationHash = hash; run.language = document.language; run.stage = 'publish'
        return save(run)
      })
    },
    publishArtifact(input: unknown) {
      return tx.write({ event: 'GENERATION_PUBLISH', action: 'CREATE', target: 'artifact' }, () => {
        const args = v.object({ id: v.id, title: v.text(500, 1) })(input), run = running(args.id)
        if (run.stage !== 'publish' || !run.assembled || repo.artifactForRun(run.id)) fail('INVALID_STATE')
        check.validateGeneratedResume(run, run.assembled)
        const now = runtime.now()
        const artifact: Artifact = { id: runtime.id(), generationRunId: run.id, type: 'RESUME', title: args.title, content: run.assembled, revision: 1,
          templateId: run.config.templateId, outputFiles: [], output: { status: 'PENDING', error: null, pages: null }, createdAt: now, updatedAt: now }
        repo.insertArtifact(artifact)
        repo.replaceLinks(artifact.id, documentProvenance(run.assembled).flatMap((link) => link.factIds.map((factId) => ({ artifactId: artifact.id, blockId: link.blockId, factId }))))
        run.status = 'SUCCEEDED'; run.stage = 'output'; run.finishedAt = now
        save(run)
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
    failRun(input: unknown) {
      return tx.write({ event: 'GENERATION_FAIL', action: 'UPDATE', target: 'generation_run' }, () => {
        const args = v.object({ id: v.id, error: v.choice(['PROVIDER_FAILED', 'VALIDATION_FAILED', 'COMPILATION_FAILED', 'AGENT_PROTOCOL_ERROR', 'AGENT_STEP_LIMIT', 'AGENT_TIMEOUT', 'AI_AUTH_FAILED', 'AI_RATE_LIMITED', 'AI_PROVIDER_FAILED', 'AI_CONNECT_FAILED', 'AUDIT_UNAVAILABLE']) })(input), run = repo.getRun(args.id)
        if (!['PENDING', 'RUNNING'].includes(run.status)) fail('INVALID_STATE')
        run.status = 'FAILED'; run.error = args.error; run.finishedAt = runtime.now()
        return save(run)
      })
    },
    recoverInterrupted() {
      return tx.write({ event: 'GENERATION_RECOVER', action: 'UPDATE', target: 'generation_run' }, () => {
        const runs = repo.running()
        for (const run of runs) { run.status = 'INTERRUPTED'; run.error = 'PROCESS_INTERRUPTED'; run.finishedAt = runtime.now(); save(run) }
        return runs.length
      })
    }
  }
}
