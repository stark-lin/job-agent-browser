import type { CandidateRepository } from './candidate.repository'
import type { Runtime, UnitOfWork, TargetType } from '../common/ports'
import { withReceipt, type OperationReceipts } from '../common/receipts'
import { fail } from '../common/errors'
import * as v from '../common/validation'
import { profileDetails, itemDetails, factDetails, importContact, importItemDetails, importFactDetails, contactLink, validateItemDates } from './candidate.validation'
import { assertParent } from './item.service'

const profileKeys = ['name', 'email', 'phone', 'location', 'links', 'introduction']
const itemKeys = ['title', 'organization', 'role', 'location', 'startDate', 'endDate', 'summary', 'sortOrder', 'metadata', 'parentItemId']
const factKeys = ['kind', 'content', 'tags', 'evidence', 'profileItemId']
function patch(keys: string[]): v.Parser<Record<string, unknown>> {
  return input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT')
    const entries = Object.entries(input)
    if (!entries.length || entries.some(([key, value]) => !keys.includes(key) || value === undefined)) fail('INVALID_INPUT')
    return Object.fromEntries(entries)
  }
}
const revision = v.integer(1, Number.MAX_SAFE_INTEGER)
const writeFields = { requestId: v.id, profileId: v.id, expectedRevision: revision }
const pick = (value: object, keys: string[]) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, (value as Record<string, unknown>)[key]]))
const same = (a: object, b: object) => Object.entries(b).every(([key, value]) => JSON.stringify((a as Record<string, unknown>)[key]) === JSON.stringify(value))

/** MCP commands own a single business transaction; never wrap another service transaction. */
export function createProfileWriteService(repo: CandidateRepository, tx: UnitOfWork, runtime: Runtime, receipts: OperationReceipts) {
  function write<T extends { requestId: string }, R extends { id: string }>(name: string, target: TargetType, input: unknown, parse: v.Parser<T>, operation: (args: T) => R) {
    return tx.write({ event: name.toUpperCase().replace(/[.]/g, '_'), action: name.includes('create') || name.includes('add_') ? 'CREATE' : 'UPDATE', target }, () => {
      const args = parse(input)
      return withReceipt(receipts, name, args.requestId, args, target, () => operation(args))
    })
  }
  function check(profileId: string, expected: number) {
    const profile = repo.getProfile(profileId)
    if (profile.revision !== expected) fail('CONFLICT')
    return profile
  }
  const result = <T extends { id: string }>(profileId: string, record: T) => ({ ...record, revision: repo.getProfile(profileId).revision })
  return {
    create(input: unknown) {
      return tx.write({ event: 'PROFILE_CREATE', action: 'CREATE', target: 'profile' }, () => {
        const args = v.object({ requestId: v.id, details: profileDetails })(input)
        return withReceipt(receipts, 'profile.create', args.requestId, args, 'profile', () => {
          const profile = { ...args.details, id: runtime.id(), updatedAt: runtime.now(), revision: 1 }
          repo.insertProfile(profile)
          return profile
        })
      })
    },
    update(input: unknown) {
      const parse = v.object({ id: v.id, requestId: v.id, expectedRevision: revision, changes: patch(profileKeys) })
      return write('profile.update', 'profile', input, parse, args => {
        const current = check(args.id, args.expectedRevision)
        if (Object.hasOwn(args.changes, 'name')) v.text(300, 1)(args.changes.name)
        if (Object.hasOwn(args.changes, 'links')) v.array(contactLink, 20)(args.changes.links)
        const details = importContact({ ...pick(current, profileKeys), ...args.changes })
        if (!same(current, details)) repo.saveProfile({ ...current, ...details, updatedAt: runtime.now() })
        return repo.getProfile(current.id)
      })
    },
    addItem(input: unknown) {
      const parse = v.object({ ...writeFields, parentItemId: v.optionalId, details: itemDetails })
      return write('profile.add_item', 'profile_item', input, parse, args => {
        check(args.profileId, args.expectedRevision)
        assertParent(repo, args.profileId, args.parentItemId)
        validateItemDates(args.details)
        const item = { ...args.details, id: runtime.id(), profileId: args.profileId, parentItemId: args.parentItemId }
        repo.insertItem(item)
        return result(args.profileId, item)
      })
    },
    updateItem(input: unknown) {
      const parse = v.object({ ...writeFields, id: v.id, changes: patch(itemKeys) })
      return write('profile.update_item', 'profile_item', input, parse, args => {
        check(args.profileId, args.expectedRevision)
        const current = repo.getItem(args.id)
        if (current.profileId !== args.profileId) fail('FORBIDDEN')
        const changes = args.changes
        if (Object.hasOwn(changes, 'metadata') && (!changes.metadata || typeof changes.metadata !== 'object' || Array.isArray(changes.metadata))) fail('INVALID_INPUT')
        if (Object.hasOwn(changes, 'title')) v.text(500, 1)(changes.title)
        const details = importItemDetails({ ...pick(current, ['type', ...itemKeys.filter(key => key !== 'parentItemId')]), ...pick(changes, itemKeys.filter(key => key !== 'parentItemId')),
          metadata: { ...current.metadata, ...(changes.metadata as object ?? {}) } })
        const parentItemId = Object.hasOwn(changes, 'parentItemId') ? v.nullable(v.id)(changes.parentItemId) : current.parentItemId
        assertParent(repo, args.profileId, parentItemId, current.id)
        validateItemDates(details)
        const item = { ...current, ...details, parentItemId }
        if (!same(current, item)) repo.saveItem(item)
        return result(args.profileId, item)
      })
    },
    addFact(input: unknown) {
      const parse = v.object({ ...writeFields, profileItemId: v.optionalId, details: factDetails })
      return write('profile.add_fact', 'fact', input, parse, args => {
        check(args.profileId, args.expectedRevision)
        if (args.profileItemId && repo.getItem(args.profileItemId).profileId !== args.profileId) fail('FORBIDDEN')
        const now = runtime.now(), fact = { ...args.details, id: runtime.id(), profileId: args.profileId, profileItemId: args.profileItemId, createdAt: now, updatedAt: now }
        repo.insertFact(fact)
        return result(args.profileId, fact)
      })
    },
    updateFact(input: unknown) {
      const parse = v.object({ ...writeFields, id: v.id, changes: patch(factKeys) })
      return write('profile.update_fact', 'fact', input, parse, args => {
        check(args.profileId, args.expectedRevision)
        const current = repo.getFact(args.id)
        if (current.profileId !== args.profileId) fail('FORBIDDEN')
        if (Object.hasOwn(args.changes, 'content')) v.text(20000, 1)(args.changes.content)
        const details = importFactDetails({ ...pick(current, factKeys.filter(key => key !== 'profileItemId')), ...pick(args.changes, factKeys.filter(key => key !== 'profileItemId')) })
        const profileItemId = Object.hasOwn(args.changes, 'profileItemId') ? v.nullable(v.id)(args.changes.profileItemId) : current.profileItemId
        if (profileItemId && repo.getItem(profileItemId).profileId !== args.profileId) fail('FORBIDDEN')
        const fact = { ...current, ...details, profileItemId }
        if (!same(current, fact)) { fact.updatedAt = runtime.now(); repo.saveFact(fact) }
        return result(args.profileId, fact)
      })
    }
  }
}
