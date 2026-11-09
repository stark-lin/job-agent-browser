import type { CandidateRepository } from './candidate.repository'
import type { Runtime, UnitOfWork } from '../common/ports'
import * as v from '../common/validation'
import { profileDetails, profileEdit } from './candidate.validation'
import { createBaselineService } from './baseline.service'
import { createItemService } from './item.service'
import { createFactService } from './fact.service'
import { createImportService } from './import.service'

export function createCandidateService(repo: CandidateRepository, tx: UnitOfWork, runtime: Runtime) {
  return {
    ...createBaselineService(repo, tx, runtime), ...createItemService(repo, tx, runtime), ...createFactService(repo, tx, runtime), ...createImportService(repo, tx, runtime),
    createProfile(input: unknown) {
      return tx.write(() => {
        const details = profileDetails(input)
        const profile = { ...details, title: details.title || details.name || 'Profile', id: runtime.id(), updatedAt: runtime.now(), revision: 1 }
        repo.insertProfile(profile)
        return profile
      })
    },
    editContact(input: unknown) {
      return tx.write(() => {
        const { id, details } = v.object({ id: v.id, details: profileEdit })(input)
        const existing = repo.getProfile(id)
        const profile = { ...existing, ...details, title: (input as { details: { title?: string } }).details.title === undefined ? existing.title : details.title, introduction: details.introduction ?? existing.introduction, updatedAt: runtime.now() }
        repo.saveProfile(profile)
        return repo.getProfile(id)
      })
    },
    deleteProfile(input: unknown) {
      return tx.write(() => { const { id } = v.byId(input); repo.getProfile(id); repo.removeProfile(id); return { id } })
    },
    getProfile(input: unknown) { return tx.read(() => repo.getProfile(v.byId(input).id)) },
    listProfiles(input: unknown) { return tx.read(() => { const args = v.page(input); return repo.profiles(args.limit, args.offset) }) }
  }
}
