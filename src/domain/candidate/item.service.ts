import type { CandidateRepository } from './candidate.repository'
import type { Runtime, UnitOfWork } from '../common/ports'
import { fail } from '../common/errors'
import * as v from '../common/validation'
import { itemDetails, validateItemDates } from './candidate.validation'

/** Parent traversal belongs to the domain; SQL foreign keys alone cannot prevent cycles. */
export function assertParent(repo: CandidateRepository, profileId: string, parentId: string | null, childId?: string): void {
  const visited = new Set<string>(childId ? [childId] : [])
  while (parentId) {
    if (visited.has(parentId)) fail('CONFLICT')
    visited.add(parentId)
    const parent = repo.getItem(parentId)
    if (parent.profileId !== profileId) fail('CONFLICT')
    parentId = parent.parentItemId
  }
}

export function createItemService(repo: CandidateRepository, tx: UnitOfWork, runtime: Runtime) {
  return {
    addItem(input: unknown) {
      return tx.write({ event: 'PROFILE_ITEM_ADD', action: 'CREATE', target: 'profile_item' }, () => {
        const args = v.object({ profileId: v.id, parentItemId: v.optionalId, details: itemDetails })(input)
        repo.getProfile(args.profileId)
        assertParent(repo, args.profileId, args.parentItemId)
        validateItemDates(args.details)
        const item = { ...args.details, id: runtime.id(), profileId: args.profileId, parentItemId: args.parentItemId }
        repo.insertItem(item)
        return item
      })
    },
    editItem(input: unknown) {
      return tx.write({ event: 'PROFILE_ITEM_EDIT', action: 'UPDATE', target: 'profile_item' }, () => {
        const { id, details } = v.object({ id: v.id, details: itemDetails })(input)
        const current = repo.getItem(id)
        if (current.type !== details.type) fail('CONFLICT')
        validateItemDates(details)
        const item = { ...current, ...details }
        repo.saveItem(item)
        return item
      })
    },
    moveItem(input: unknown) {
      return tx.write({ event: 'PROFILE_ITEM_MOVE', action: 'UPDATE', target: 'profile_item' }, () => {
        const args = v.object({ id: v.id, parentItemId: v.nullable(v.id), sortOrder: v.integer(0, 1_000_000) })(input)
        const item = repo.getItem(args.id)
        assertParent(repo, item.profileId, args.parentItemId, item.id)
        Object.assign(item, { parentItemId: args.parentItemId, sortOrder: args.sortOrder })
        repo.saveItem(item)
        return item
      })
    },
    deleteItem(input: unknown) {
      return tx.write({ event: 'PROFILE_ITEM_DELETE', action: 'DELETE', target: 'profile_item' }, () => { const { id } = v.byId(input); repo.getItem(id); repo.removeItem(id); return { id } })
    },
    listItems(input: unknown) { return tx.read(() => { const args = v.object({ profileId: v.id, ...v.pageFields })(input); repo.getProfile(args.profileId); return repo.items(args.profileId, args.limit, args.offset) }) }
  }
}
