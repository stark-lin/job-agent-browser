import type { CandidateRepository } from './candidate.repository'
import type { Runtime, UnitOfWork } from '../common/ports'
import { fail } from '../common/errors'
import { unique } from '../common/validation'
import { importContact, importItemDetails, importFactDetails, validateItemDates } from './candidate.validation'
import { applyImportInput } from './import.validation'
import type { ImportOrder, ImportSaved } from './import.types'
import type { Fact, Profile } from './candidate.types'

/** One transaction for the explicitly saved subset; session ownership/replay lives in Main. */
export function createImportService(repo: CandidateRepository, tx: UnitOfWork, runtime: Runtime) {
  return {
    applyImport(input: unknown, order?: ImportOrder): ImportSaved {
      return tx.write(() => {
        const args = applyImportInput(input)
        if (!Object.values(args.contact).some(value => value !== undefined) && !args.items.length && !args.facts.length && !args.links.length) fail('INVALID_INPUT')
        unique([...args.items, ...args.facts, ...args.links].map(entry => entry.draftId))
        const patch = Object.fromEntries(Object.entries(args.contact).filter(([, value]) => value !== undefined))
        const existing = args.profileId ? repo.getProfile(args.profileId) : null
        const details = importContact({ name: existing?.name, email: existing?.email, phone: existing?.phone, location: existing?.location, introduction: existing?.introduction,
          ...patch, links: [...(existing?.links ?? []), ...args.links.map(({ label, url }) => ({ label, url }))] })
        const profile: Profile = { ...details, id: existing?.id ?? runtime.id(), updatedAt: runtime.now(), revision: existing?.revision ?? 1 }
        if (existing) repo.saveProfile(profile)
        else repo.insertProfile(profile)
        const itemIds: Record<string, string> = {}, factIds: Record<string, string> = {}
        const base = order?.base ?? repo.reserveOrder(profile.id, order?.items.length ?? args.items.length, order?.facts.length ?? args.facts.length)
        const position = (ids: string[] | undefined, draftId: string, fallback: number) => {
          const index = ids ? ids.indexOf(draftId) : fallback
          if (index < 0) fail('CONFLICT')
          return index
        }
        const items = args.items.map((entry, index) => {
          const parsed = importItemDetails(entry.details)
          validateItemDates(parsed)
          const item = { ...parsed, sortOrder: base.item + position(order?.items, entry.draftId, index), id: runtime.id(), profileId: profile.id, parentItemId: null }
          repo.insertItem(item); itemIds[entry.draftId] = item.id
          return item
        })
        const facts = args.facts.map((entry, index) => {
          if (entry.itemDraftId && entry.profileItemId) fail('CONFLICT')
          const itemId = entry.itemDraftId ? itemIds[entry.itemDraftId] : entry.profileItemId
          if (entry.itemDraftId && !itemId) fail('CONFLICT')
          if (itemId && repo.getItem(itemId).profileId !== profile.id) fail('CONFLICT')
          const now = runtime.now()
          const fact: Fact = { ...importFactDetails(entry.details), id: runtime.id(), profileId: profile.id, profileItemId: itemId ?? null,
            createdAt: now, updatedAt: now }
          repo.insertFact(fact, base.fact + position(order?.facts, entry.draftId, index))
          factIds[entry.draftId] = fact.id
          return fact
        })
        return { ...(order ? { orderBase: base } : {}), profile: repo.getProfile(profile.id), items, facts, itemIds, factIds }
      })
    }
  }
}
