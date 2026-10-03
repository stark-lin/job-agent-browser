import type { ResumeRepository } from './resume.repository'
import type { Runtime, UnitOfWork } from '../common/ports'
import type { Artifact, GenerationRun } from './resume.types'
import { fail } from '../common/errors'
import * as v from '../common/validation'
import * as check from './resume.validation'

/** Main-only persistence steps. They perform no AI/network work and are never exposed over IPC. */
export function createGenerationService(repo: ResumeRepository, tx: UnitOfWork, runtime: Runtime) {
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
        run.status = 'RUNNING'
        return save(run)
      })
    },
    recordScores(input: unknown) {
      return tx.write({ event: 'GENERATION_SCORE', action: 'UPDATE', target: 'generation_run' }, () => {
        const args = v.object({ id: v.id, scores: check.scores })(input), run = running(args.id)
        if (run.scores) fail('INVALID_STATE')
        v.unique(args.scores.map((score) => score.factId))
        if (args.scores.length !== run.inputSnapshot.facts.length || args.scores.some((score) => !run.inputSnapshot.facts.some((fact) => fact.id === score.factId))) fail('CONFLICT')
        run.scores = args.scores
        return save(run)
      })
    },
    recordGate(input: unknown) {
      return tx.write({ event: 'GENERATION_GATE', action: 'UPDATE', target: 'generation_run' }, () => {
        const args = v.object({ id: v.id, gate: check.gate })(input), run = running(args.id)
        if (!run.scores || run.gate) fail('INVALID_STATE')
        run.gate = args.gate
        if (!args.gate.passed) { run.status = 'FAILED'; run.error = 'GATE_REJECTED'; run.finishedAt = runtime.now() }
        return save(run)
      })
    },
    selectEvidence(input: unknown) {
      return tx.write({ event: 'GENERATION_SELECT', action: 'UPDATE', target: 'generation_run' }, () => {
        const args = v.object({ id: v.id, selection: check.selection })(input), run = running(args.id)
        if (!run.gate?.passed || run.selection) fail('INVALID_STATE')
        v.unique(args.selection.factIds); v.unique(args.selection.itemIds)
        if (!args.selection.factIds.length || args.selection.wordBudget > run.config.targetWordCount) fail('CONFLICT')
        if (args.selection.factIds.some((id) => !run.inputSnapshot.facts.some((fact) => fact.id === id)) || args.selection.itemIds.some((id) => !run.inputSnapshot.items.some((item) => item.id === id))) fail('CONFLICT')
        run.selection = args.selection
        return save(run)
      })
    },
    saveDraft(input: unknown) {
      return tx.write({ event: 'GENERATION_DRAFT', action: 'UPDATE', target: 'generation_run' }, () => {
        const args = v.object({ id: v.id, content: check.content })(input), run = running(args.id)
        if (!run.selection || run.draft) fail('INVALID_STATE')
        check.validateContent(run, args.content)
        run.draft = args.content
        return save(run)
      })
    },
    savePolished(input: unknown) {
      return tx.write({ event: 'GENERATION_POLISH', action: 'UPDATE', target: 'generation_run' }, () => {
        const args = v.object({ id: v.id, content: check.content })(input), run = running(args.id)
        if (!run.draft || run.polished) fail('INVALID_STATE')
        check.validateContent(run, args.content)
        run.polished = args.content
        return save(run)
      })
    },
    publishArtifact(input: unknown) {
      return tx.write({ event: 'GENERATION_PUBLISH', action: 'CREATE', target: 'artifact' }, () => {
        const args = v.object({ id: v.id, title: v.text(500, 1), provenance: check.provenance })(input), run = running(args.id)
        if (!run.polished || repo.artifactForRun(run.id)) fail('INVALID_STATE')
        check.validateContent(run, run.polished, args.provenance)
        const now = runtime.now()
        const artifact: Artifact = { id: runtime.id(), generationRunId: run.id, type: 'RESUME', title: args.title, content: run.polished,
          templateId: run.config.templateId, outputFiles: [], createdAt: now, updatedAt: now }
        repo.insertArtifact(artifact)
        repo.replaceLinks(artifact.id, args.provenance.flatMap((link) => link.factIds.map((factId) => ({ artifactId: artifact.id, blockId: link.blockId, factId }))))
        run.status = 'SUCCEEDED'; run.finishedAt = now
        save(run)
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
    failRun(input: unknown) {
      return tx.write({ event: 'GENERATION_FAIL', action: 'UPDATE', target: 'generation_run' }, () => {
        const args = v.object({ id: v.id, error: v.choice(['PROVIDER_FAILED', 'VALIDATION_FAILED', 'COMPILATION_FAILED']) })(input), run = running(args.id)
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
