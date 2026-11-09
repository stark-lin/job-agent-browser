import type { CandidateRepository } from './candidate.repository'
import type { Profile, ProfileBaselineV1, ProfileBaselineStatus } from './candidate.types'
import type { Runtime, UnitOfWork } from '../common/ports'
import { fail } from '../common/errors'
import * as v from '../common/validation'
import { importContact, importItemDetails, importFactDetails, validateItemDates } from './candidate.validation'

const versioned = { profileId: v.id, expectedRevision: v.integer(1, Number.MAX_SAFE_INTEGER) }
/** Validate complete structured copies, including imported records with intentionally blank fields. */
export function validateBaseline(input: unknown, profileId: string): ProfileBaselineV1 {
  const snapshot = v.object({
    profile: v.object({ title: v.text(300), name: v.text(300), email: v.text(320), phone: v.text(100), location: v.text(1000),
      links: value => importContact({ links: value }).links, introduction: v.text(2000) }),
    items: v.array(value => {
      if (!value || typeof value !== 'object') fail('INVALID_INPUT')
      const { id, profileId, parentItemId, ...details } = value as Record<string, unknown>
      return { ...importItemDetails(details), id: v.id(id), profileId: v.id(profileId), parentItemId: v.nullable(v.id)(parentItemId) }
    }, Number.MAX_SAFE_INTEGER),
    facts: v.array(value => {
      if (!value || typeof value !== 'object') fail('INVALID_INPUT')
      const { id, profileId, profileItemId, sortOrder, createdAt, updatedAt, ...details } = value as Record<string, unknown>
      return { ...importFactDetails(details), id: v.id(id), profileId: v.id(profileId), profileItemId: v.nullable(v.id)(profileItemId),
        sortOrder: v.integer(0, Number.MAX_SAFE_INTEGER - 1)(sortOrder), createdAt: v.timestamp(createdAt), updatedAt: v.timestamp(updatedAt) }
    }, Number.MAX_SAFE_INTEGER)
  })(input)
  v.unique(snapshot.items.map(item => item.id)); v.unique(snapshot.facts.map(fact => fact.id))
  const items = new Map(snapshot.items.map(item => [item.id, item]))
  for (const item of snapshot.items) {
    validateItemDates(item)
    if (item.profileId !== profileId) fail('INVALID_INPUT')
    const visited = new Set([item.id])
    let parent = item.parentItemId
    while (parent) {
      if (visited.has(parent) || !items.has(parent)) fail('INVALID_INPUT')
      visited.add(parent); parent = items.get(parent)!.parentItemId
    }
  }
  for (const fact of snapshot.facts) if (fact.profileId !== profileId || fact.profileItemId && !items.has(fact.profileItemId)) fail('INVALID_INPUT')
  return snapshot
}

export function captureProfileBaseline(repo: CandidateRepository, profile: Profile) {
  const { id, revision: _revision, updatedAt: _updated, ...details } = profile
  return validateBaseline({ profile: details, items: repo.allItems(id), facts: repo.orderedFacts(id) }, id)
}

/** User approval endpoints belong to trusted UI IPC, never the Agent registry. */
export function createBaselineService(repo: CandidateRepository, tx: UnitOfWork, runtime: Runtime) {
  function check(id: string, revision: number) {
    const profile = repo.getProfile(id)
    if (profile.revision !== revision) fail('CONFLICT')
    return profile
  }
  function status(profileId: string): ProfileBaselineStatus {
    const baseline = repo.getBaseline(profileId)
    return { profileId, status: baseline ? 'READY' : 'DRAFT', createdAt: baseline?.createdAt ?? null }
  }
  function rebuild(profileId: string, snapshot: ProfileBaselineV1) {
    // Existing repositories break equal sortOrder ties by UUID. Allocate fresh IDs in source
    // order so restoring/duplicating tied positions retains that ordering as well.
    const itemIds = snapshot.items.map(() => runtime.id()).sort()
    const ids = new Map(snapshot.items.map((item, index) => [item.id, itemIds[index]]))
    const remaining = new Map(snapshot.items.map(item => [item.id, item])), inserted = new Set<string>()
    while (remaining.size) {
      for (const [id, item] of remaining) {
        if (item.parentItemId && !inserted.has(item.parentItemId)) continue
        repo.insertItem({ ...item, id: ids.get(id)!, profileId, parentItemId: item.parentItemId ? ids.get(item.parentItemId)! : null })
        inserted.add(id); remaining.delete(id)
      }
    }
    const factIds = snapshot.facts.map(() => runtime.id()).sort(), now = runtime.now()
    for (const [index, { sortOrder, ...fact }] of snapshot.facts.entries()) {
      repo.insertFact({ ...fact, id: factIds[index], profileId, profileItemId: fact.profileItemId ? ids.get(fact.profileItemId)! : null, createdAt: now, updatedAt: now }, sortOrder)
    }
    repo.syncOrderCounters(profileId)
    return repo.getProfile(profileId)
  }
  return {
    getBaselineStatus(input: unknown) { return tx.read(() => { const { profileId } = v.object({ profileId: v.id })(input); repo.getProfile(profileId); return status(profileId) }) },
    freezeBaseline(input: unknown) {
      return tx.write(() => {
        const args = v.object(versioned)(input), profile = check(args.profileId, args.expectedRevision)
        if (repo.getBaseline(profile.id)) fail('CONFLICT')
        repo.insertBaseline({ profileId: profile.id, schemaVersion: 1, snapshot: captureProfileBaseline(repo, profile), createdAt: runtime.now() })
        return status(profile.id)
      })
    },
    duplicateProfile(input: unknown) {
      return tx.write(() => {
        const args = v.object({ ...versioned, title: v.text(300, 1) })(input), source = check(args.profileId, args.expectedRevision)
        const snapshot = captureProfileBaseline(repo, source), profile = { ...snapshot.profile, title: args.title, id: runtime.id(), revision: 1, updatedAt: runtime.now() }
        repo.insertProfile(profile)
        return rebuild(profile.id, snapshot)
      })
    },
    restoreBaseline(input: unknown) {
      return tx.write(() => {
        const args = v.object(versioned)(input), profile = check(args.profileId, args.expectedRevision), baseline = repo.getBaseline(profile.id)
        if (!baseline) fail('NOT_FOUND')
        if (baseline.schemaVersion !== 1) fail('INVALID_INPUT')
        const snapshot = validateBaseline(baseline.snapshot, profile.id)
        repo.clearWorkingContent(profile.id)
        repo.saveProfile({ ...profile, ...snapshot.profile, revision: repo.getProfile(profile.id).revision, updatedAt: runtime.now() })
        return rebuild(profile.id, snapshot)
      })
    }
  }
}
