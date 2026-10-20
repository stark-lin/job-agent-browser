import type { CandidateRepository } from './candidate.repository'
import type { Runtime, UnitOfWork } from '../common/ports'
import { fail } from '../common/errors'
import { unique } from '../common/validation'
import { contact, itemDetails, factDetails, validateItemDates } from './candidate.validation'
import { confirmedImport } from './import.validation'
import type { ImportSaved } from './import.types'
import type { Fact, Profile } from './candidate.types'
import { confirmFactRecord } from './fact.service'

/** One transaction for the complete confirmed subset; session ownership/replay lives in Main. */
export function createImportService(repo: CandidateRepository, tx: UnitOfWork, runtime: Runtime) {
  return {
    applyConfirmedImport(input: unknown): ImportSaved {
      return tx.write({ event: 'PROFILE_IMPORT', action: 'CREATE', target: 'profile' }, () => {
        const args = confirmedImport(input)
        if (!Object.values(args.contact).some(value => value !== undefined) && !args.items.length && !args.facts.length && !args.links.length) fail('INVALID_INPUT')
        unique([...args.items, ...args.facts, ...args.links].map(entry => entry.draftId))
        const patch = Object.fromEntries(Object.entries(args.contact).filter(([, value]) => value !== undefined))
        const existing = args.profileId ? repo.getProfile(args.profileId) : null
        const details = contact({ name: existing?.name, email: existing?.email, phone: existing?.phone, location: existing?.location,
          ...patch, links: [...(existing?.links ?? []), ...args.links.map(({ label, url }) => ({ label, url }))] })
        const profile: Profile = { ...details, id: existing?.id ?? runtime.id(), updatedAt: runtime.now() }
        if (existing) repo.saveProfile(profile)
        else repo.insertProfile(profile)
        const itemIds: Record<string, string> = {}, factIds: Record<string, string> = {}
        const current = repo.allItems(profile.id)
        const offset = current.reduce((max, item) => Math.max(max, item.sortOrder + 1), 0)
        const items = args.items.map((entry, index) => {
          const parsed = itemDetails(entry.details)
          validateItemDates(parsed)
          const item = { ...parsed, sortOrder: offset + index, id: runtime.id(), profileId: profile.id, parentItemId: null }
          repo.insertItem(item); itemIds[entry.draftId] = item.id
          return item
        })
        const facts = args.facts.map(entry => {
          if (entry.itemDraftId && entry.profileItemId) fail('CONFLICT')
          const itemId = entry.itemDraftId ? itemIds[entry.itemDraftId] : entry.profileItemId
          if (entry.itemDraftId && !itemId) fail('CONFLICT')
          if (itemId && repo.getItem(itemId).profileId !== profile.id) fail('CONFLICT')
          const now = runtime.now()
          const fact: Fact = { ...factDetails(entry.details), id: runtime.id(), profileId: profile.id, profileItemId: itemId ?? null,
            verificationStatus: 'UNVERIFIED', createdAt: now, updatedAt: now }
          repo.insertFact(fact)
          factIds[entry.draftId] = fact.id
          return confirmFactRecord(repo, runtime, fact.id)
        })
        return { profile, items, facts, itemIds, factIds }
      })
    }
  }
}
