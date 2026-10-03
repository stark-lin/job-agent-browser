import type { PageResult } from '../common/ports'
import type { Fact, Profile, ProfileItem } from './candidate.types'

export interface CandidateRepository {
  getProfile(id: string): Profile
  profiles(limit: number, offset: number): PageResult<Profile>
  insertProfile(profile: Profile): void
  saveProfile(profile: Profile): void
  removeProfile(id: string): void
  getItem(id: string): ProfileItem
  items(profileId: string, limit: number, offset: number): PageResult<ProfileItem>
  allItems(profileId: string): ProfileItem[]
  insertItem(item: ProfileItem): void
  saveItem(item: ProfileItem): void
  removeItem(id: string): void
  getFact(id: string): Fact
  facts(profileId: string, limit: number, offset: number): PageResult<Fact>
  insertFact(fact: Fact): void
  saveFact(fact: Fact): void
  removeFact(id: string): void
}
