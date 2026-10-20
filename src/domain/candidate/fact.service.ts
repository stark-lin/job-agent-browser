import type { CandidateRepository } from './candidate.repository'
import type { Runtime, UnitOfWork } from '../common/ports'
import { fail } from '../common/errors'
import * as v from '../common/validation'
import { factDetails } from './candidate.validation'
import type { Fact } from './candidate.types'

/** Shared confirmation operation; caller owns the surrounding business transaction. */
export function confirmFactRecord(repo: CandidateRepository, runtime: Runtime, id: string): Fact {
  const fact = { ...repo.getFact(id), verificationStatus: 'CONFIRMED' as const, updatedAt: runtime.now() }
  repo.saveFact(fact)
  return fact
}

export function createFactService(repo: CandidateRepository, tx: UnitOfWork, runtime: Runtime) {
  function checkItem(profileId: string, itemId: string | null) {
    if (itemId && repo.getItem(itemId).profileId !== profileId) fail('CONFLICT')
  }
  return {
    addFact(input: unknown) {
      return tx.write({ event: 'FACT_ADD', action: 'CREATE', target: 'fact' }, () => {
        const args = v.object({ profileId: v.id, profileItemId: v.optionalId, details: factDetails })(input)
        repo.getProfile(args.profileId)
        checkItem(args.profileId, args.profileItemId)
        const now = runtime.now()
        const fact: Fact = { ...args.details, id: runtime.id(), profileId: args.profileId, profileItemId: args.profileItemId, verificationStatus: 'UNVERIFIED', createdAt: now, updatedAt: now }
        repo.insertFact(fact)
        return fact
      })
    },
    editFact(input: unknown) {
      return tx.write({ event: 'FACT_EDIT', action: 'UPDATE', target: 'fact' }, () => {
        const args = v.object({ id: v.id, profileItemId: v.optionalId, details: factDetails })(input)
        const current = repo.getFact(args.id)
        checkItem(current.profileId, args.profileItemId)
        // Editing evidence or content invalidates the previous confirmation.
        const fact: Fact = { ...current, ...args.details, profileItemId: args.profileItemId, verificationStatus: 'UNVERIFIED', updatedAt: runtime.now() }
        repo.saveFact(fact)
        return fact
      })
    },
    confirmFact(input: unknown) {
      return tx.write({ event: 'FACT_CONFIRM', action: 'UPDATE', target: 'fact' }, () => {
        return confirmFactRecord(repo, runtime, v.byId(input).id)
      })
    },
    deleteFact(input: unknown) {
      return tx.write({ event: 'FACT_DELETE', action: 'DELETE', target: 'fact' }, () => { const { id } = v.byId(input); repo.getFact(id); repo.removeFact(id); return { id } })
    },
    listFacts(input: unknown) { return tx.read(() => { const args = v.object({ profileId: v.id, ...v.pageFields })(input); repo.getProfile(args.profileId); return repo.facts(args.profileId, args.limit, args.offset) }) }
  }
}
