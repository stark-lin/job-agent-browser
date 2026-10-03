import type { CandidateRepository } from '../../../domain/candidate/candidate.repository'
import type { ProfileItem } from '../../../domain/candidate/candidate.types'
import type { Store } from './store'

export function candidateRepository(store: Store): CandidateRepository {
  return {
    getProfile: (id) => store.get('profile', id), profiles: (limit, offset) => store.list('profiles', '1=1', [], 'updated_at DESC, id', limit, offset),
    insertProfile: (profile) => store.insert('profile', profile), saveProfile: (profile) => store.save('profile', profile), removeProfile: (id) => store.remove('profile', id),
    getItem: (id) => store.get('profile_item', id), items: (id, limit, offset) => store.list('profile_items', 'profile_id=?', [id], 'sort_order, id', limit, offset),
    allItems: (id) => store.db.prepare('SELECT * FROM profile_items WHERE profile_id=? ORDER BY sort_order,id').all(id).map((row) => store.decode<ProfileItem>(row)),
    insertItem: (item) => store.insert('profile_item', item), saveItem: (item) => store.save('profile_item', item), removeItem: (id) => store.remove('profile_item', id),
    getFact: (id) => store.get('fact', id), facts: (id, limit, offset) => store.list('facts', 'profile_id=?', [id], 'created_at, id', limit, offset),
    insertFact: (fact) => store.insert('fact', fact), saveFact: (fact) => store.save('fact', fact), removeFact: (id) => store.remove('fact', id)
  }
}
