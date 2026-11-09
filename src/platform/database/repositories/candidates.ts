import type { CandidateRepository } from '../../../domain/candidate/candidate.repository'
import type { Fact, ProfileItem } from '../../../domain/candidate/candidate.types'
import type { Store } from './store'
import { fail } from '../../../domain/common/errors'

export function candidateRepository(store: Store): CandidateRepository {
  function reserveOrder(profileId: string, items: number, facts: number) {
    const next = store.db.prepare(`SELECT
      max(coalesce((SELECT max(sort_order)+1 FROM profile_items WHERE profile_id=?),0),
          coalesce((SELECT next_item FROM profile_order_counters WHERE profile_id=?),0)) item,
      max(coalesce((SELECT max(sort_order)+1 FROM facts WHERE profile_id=?),0),
          coalesce((SELECT next_fact FROM profile_order_counters WHERE profile_id=?),0)) fact`).get(profileId, profileId, profileId, profileId)!
    const item = Number(next.item), fact = Number(next.fact)
    if (!Number.isSafeInteger(item + items) || !Number.isSafeInteger(fact + facts)) fail('CONFLICT')
    if (items || facts) store.db.prepare(`INSERT INTO profile_order_counters VALUES(?,?,?)
      ON CONFLICT(profile_id) DO UPDATE SET next_item=excluded.next_item,next_fact=excluded.next_fact`).run(profileId, item + items, fact + facts)
    return { item, fact }
  }
  const factOrder = 'sort_order, created_at, id'
  const factFields = 'id, profile_id, profile_item_id, kind, content, tags_json, created_at, updated_at'
  return {
    getBaseline: id => {
      const row = store.db.prepare('SELECT * FROM profile_baselines WHERE profile_id=?').get(id)
      return row ? store.decode(row) : null
    },
    insertBaseline: baseline => { store.db.prepare('INSERT INTO profile_baselines VALUES(?,?,?,?)').run(baseline.profileId, baseline.schemaVersion, JSON.stringify(baseline.snapshot), baseline.createdAt) },
    clearWorkingContent: id => {
      store.db.prepare('DELETE FROM facts WHERE profile_id=?').run(id)
      store.db.prepare('DELETE FROM profile_items WHERE profile_id=?').run(id)
    },
    syncOrderCounters: id => {
      store.db.prepare('DELETE FROM profile_order_counters WHERE profile_id=?').run(id)
      const next = reserveOrder(id, 0, 0)
      store.db.prepare('INSERT INTO profile_order_counters VALUES(?,?,?)').run(id, next.item, next.fact)
    },
    orderedFacts: id => store.db.prepare(`SELECT * FROM facts WHERE profile_id=? ORDER BY ${factOrder}`).all(id).map(row => store.decode<Fact & { sortOrder: number }>(row)),
    getProfile: (id) => store.get('profile', id), profiles: (limit, offset) => store.list('profiles', '1=1', [], 'updated_at DESC, id', limit, offset),
    insertProfile: (profile) => store.insert('profile', profile), saveProfile: (profile) => store.save('profile', profile), removeProfile: (id) => store.remove('profile', id),
    getItem: (id) => store.get('profile_item', id), items: (id, limit, offset) => store.list('profile_items', 'profile_id=?', [id], 'sort_order, id', limit, offset),
    allItems: (id) => store.db.prepare('SELECT * FROM profile_items WHERE profile_id=? ORDER BY sort_order,id').all(id).map((row) => store.decode<ProfileItem>(row)),
    insertItem: (item) => store.insert('profile_item', item), saveItem: (item) => store.save('profile_item', item), removeItem: (id) => store.remove('profile_item', id),
    allFacts: id => store.db.prepare(`SELECT ${factFields} FROM facts WHERE profile_id=? ORDER BY ${factOrder}`).all(id).map(row => store.decode<Fact>(row)),
    getFact: (id) => {
      const { sortOrder: _order, ...fact } = store.get<Fact & { sortOrder?: number }>('fact', id)
      return fact
    },
    facts: (id, limit, offset) => {
      const page = store.list<Fact & { sortOrder?: number }>('facts', 'profile_id=?', [id], factOrder, limit, offset)
      return { ...page, items: page.items.map(({ sortOrder: _order, ...fact }) => fact) }
    },
    reserveOrder,
    insertFact: (fact, sortOrder) => store.insert('fact', { ...fact, sortOrder: sortOrder ?? reserveOrder(fact.profileId, 0, 1).fact }), saveFact: (fact) => store.save('fact', fact), removeFact: (id) => store.remove('fact', id)
  }
}
