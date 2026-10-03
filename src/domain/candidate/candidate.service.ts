import type { CandidateRepository } from './candidate.repository'
import type { Runtime, UnitOfWork } from '../common/ports'
import * as v from '../common/validation'
import { contact } from './candidate.validation'
import { createItemService } from './item.service'
import { createFactService } from './fact.service'

export function createCandidateService(repo: CandidateRepository, tx: UnitOfWork, runtime: Runtime) {
  return {
    ...createItemService(repo, tx, runtime), ...createFactService(repo, tx, runtime),
    createProfile(input: unknown) {
      return tx.write({ event: 'PROFILE_CREATE', action: 'CREATE', target: 'profile' }, () => {
        const profile = { ...contact(input), id: runtime.id(), updatedAt: runtime.now() }
        repo.insertProfile(profile)
        return profile
      })
    },
    editContact(input: unknown) {
      return tx.write({ event: 'PROFILE_CONTACT_EDIT', action: 'UPDATE', target: 'profile' }, () => {
        const { id, details } = v.object({ id: v.id, details: contact })(input)
        const profile = { ...repo.getProfile(id), ...details, updatedAt: runtime.now() }
        repo.saveProfile(profile)
        return profile
      })
    },
    deleteProfile(input: unknown) {
      return tx.write({ event: 'PROFILE_DELETE', action: 'DELETE', target: 'profile' }, () => { const { id } = v.byId(input); repo.getProfile(id); repo.removeProfile(id); return { id } })
    },
    getProfile(input: unknown) { return tx.read(() => repo.getProfile(v.byId(input).id)) },
    listProfiles(input: unknown) { return tx.read(() => { const args = v.page(input); return repo.profiles(args.limit, args.offset) }) }
  }
}
