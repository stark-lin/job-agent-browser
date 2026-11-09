import type { CandidateRepository } from '../candidate/candidate.repository'
import type { JobRepository } from '../job/job.repository'
import type { ResumeRepository } from './resume.repository'
import type { References, Runtime, UnitOfWork } from '../common/ports'
import { fail } from '../common/errors'
import * as v from '../common/validation'
import * as check from './resume.validation'
import type { GenerationRun, InputSnapshot } from './resume.types'
import { createArtifactService } from './artifact.service'
import { createResumeFromProfile } from './document'
import { isGenerating, transition } from './state-machine'
import { snapshotReferences } from './references'

export function createResumeService(jobs: JobRepository, candidate: CandidateRepository, repo: ResumeRepository, tx: UnitOfWork, runtime: Runtime, refs: References, runtimeKind: 'internal' | 'external' = 'internal') {
  return {
    ...createArtifactService(repo, tx, runtime, refs),
    createRun(input: unknown, options: { start?: boolean; requestId?: string; validateSnapshot?(snapshot: InputSnapshot): void; checkSize?(run: GenerationRun): void; internal?: boolean } = {}) {
      return tx.write(() => {
        const args = v.object({ jobId: v.id, profileId: v.id, config: v.optional(check.config, check.config({})) })(input)
        const identity = JSON.stringify(args)
        if (options.requestId) {
          v.id(options.requestId)
          const previous = repo.requestRun(options.requestId, identity)
          if (previous) return previous
        }
        const job = jobs.get(args.jobId), profile = candidate.getProfile(args.profileId)
        if (job.archivedAt) fail('INVALID_STATE')
        const facts = candidate.allFacts(profile.id), items = candidate.allItems(profile.id)
        const now = runtime.now()
        const run: GenerationRun = { id: runtime.id(), jobId: job.id, type: 'RESUME', agentRunId: null,
          state: 'CREATED', stateVersion: 0,
          inputSnapshot: { schemaVersion: 1, job, profile, facts, items }, assembled: null,
          config: { ...args.config, runtimeKind: options.start ? options.internal ? 'internal' : 'external' : runtimeKind }, error: null, createdAt: now, updatedAt: now, finishedAt: null }
        options.validateSnapshot?.(run.inputSnapshot)
        repo.insertRun(run)
        if (options.start) {
          transition(run, 'COPYING', runtime.now()); repo.saveRun(run)
          run.assembled = createResumeFromProfile(run.inputSnapshot, runtime.id)
          check.validateGeneratedResume(run, run.assembled)
          options.checkSize?.(run)
          transition(run, 'REWRITING', runtime.now()); repo.saveRun(run)
        }
        if (options.requestId) repo.recordRequest(options.requestId, identity, run.id)
        return run
      })
    },
    cancelRun(input: unknown) {
      return tx.write(() => {
        const run = repo.getRun(v.byId(input).id)
        transition(run, 'CANCELLED', runtime.now())
        repo.saveRun(run)
        return run
      })
    },
    deleteRun(input: unknown) {
      return tx.write(() => {
        const { id } = v.byId(input), run = repo.getRun(id)
        if (isGenerating(run.state) && run.state !== 'CREATED') fail('INVALID_STATE')
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
