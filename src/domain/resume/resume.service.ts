import type { CandidateRepository } from '../candidate/candidate.repository'
import type { JobRepository } from '../job/job.repository'
import type { ResumeRepository } from './resume.repository'
import type { References, Runtime, UnitOfWork } from '../common/ports'
import { fail } from '../common/errors'
import * as v from '../common/validation'
import * as check from './resume.validation'
import type { GenerationRun } from './resume.types'
import { createArtifactService } from './artifact.service'
import { snapshotReferences } from './references'

export function createResumeService(jobs: JobRepository, candidate: CandidateRepository, repo: ResumeRepository, tx: UnitOfWork, runtime: Runtime, refs: References) {
  return {
    ...createArtifactService(repo, tx, runtime, refs),
    createRun(input: unknown) {
      return tx.write({ event: 'GENERATION_CREATE', action: 'CREATE', target: 'generation_run' }, () => {
        const args = v.object({ jobId: v.id, profileId: v.id, config: v.optional(check.config, check.config({})) })(input)
        const job = jobs.get(args.jobId), profile = candidate.getProfile(args.profileId)
        if (job.archivedAt) fail('INVALID_STATE')
        const facts = candidate.allFacts(profile.id), items = candidate.allItems(profile.id)
        if (!facts.length) fail('INVALID_INPUT')
        const now = runtime.now()
        const run: GenerationRun = { id: runtime.id(), jobId: job.id, type: 'RESUME', status: 'PENDING', stage: 'snapshot', language: null,
          inputSnapshot: { schemaVersion: 1, job, profile, facts, items },
          scores: null, gate: null, selection: null, draft: null, polished: null, config: args.config, error: null,
          createdAt: now, updatedAt: now, finishedAt: null }
        repo.insertRun(run)
        return run
      })
    },
    cancelRun(input: unknown) {
      return tx.write({ event: 'GENERATION_CANCEL', action: 'UPDATE', target: 'generation_run' }, () => {
        const run = repo.getRun(v.byId(input).id)
        if (!['PENDING', 'RUNNING'].includes(run.status)) fail('INVALID_STATE')
        run.status = 'CANCELLED'; run.updatedAt = runtime.now(); run.finishedAt = run.updatedAt
        repo.saveRun(run)
        return run
      })
    },
    deleteRun(input: unknown) {
      return tx.write({ event: 'GENERATION_DELETE', action: 'DELETE', target: 'generation_run' }, () => {
        const { id } = v.byId(input), run = repo.getRun(id)
        if (run.status === 'RUNNING') fail('INVALID_STATE')
        repo.removeRun(id)
        return { id }
      })
    },
    getRun(input: unknown) { return tx.read(() => { const run = repo.getRun(v.byId(input).id); return { run, references: snapshotReferences(run.inputSnapshot, refs) } }) },
    listRuns(input: unknown) { return tx.read(() => {
      const args = v.object({ jobId: v.optionalId, ...v.pageFields })(input)
      const page = repo.runs(args.jobId, args.limit, args.offset)
      return { total: page.total, items: page.items.map((run) => ({ run, references: snapshotReferences(run.inputSnapshot, refs) })) }
    }) }
  }
}
