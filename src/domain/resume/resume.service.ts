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
        const args = v.object({ jobId: v.id, profileId: v.id, factIds: v.array(v.id), itemIds: v.optional(v.array(v.id), []), config: v.optional(check.config, check.config({})) })(input)
        v.unique(args.factIds); v.unique(args.itemIds)
        if (!args.factIds.length) fail('INVALID_INPUT')
        const job = jobs.get(args.jobId), profile = candidate.getProfile(args.profileId)
        if (job.archivedAt) fail('INVALID_STATE')
        const facts = args.factIds.map((id) => candidate.getFact(id))
        if (facts.some((fact) => fact.profileId !== profile.id)) fail('CONFLICT')
        const itemIds = new Set([...args.itemIds, ...facts.flatMap((fact) => fact.profileItemId ? [fact.profileItemId] : [])])
        // Include ancestors so a historical snapshot remains understandable after deletion.
        for (const id of itemIds) {
          const item = candidate.getItem(id)
          if (item.profileId !== profile.id) fail('CONFLICT')
          if (item.parentItemId) itemIds.add(item.parentItemId)
          if (itemIds.size > 1000) fail('CONFLICT')
        }
        const now = runtime.now()
        const run: GenerationRun = { id: runtime.id(), jobId: job.id, type: 'RESUME', status: 'PENDING',
          inputSnapshot: { schemaVersion: 1, job, profile, facts, items: [...itemIds].map((id) => candidate.getItem(id)) },
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
