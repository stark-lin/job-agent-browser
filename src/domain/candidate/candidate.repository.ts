import type { PageResult } from '../common/ports'
import type { Fact, Profile, ProfileItem, ProfileBaseline } from './candidate.types'

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
  getBaseline(profileId: string): ProfileBaseline | null
  insertBaseline(baseline: ProfileBaseline): void
  clearWorkingContent(profileId: string): void
  syncOrderCounters(profileId: string): void
  orderedFacts(profileId: string): Array<Fact & { sortOrder: number }>
  allFacts(profileId: string): Fact[]
  getFact(id: string): Fact
  facts(profileId: string, limit: number, offset: number): PageResult<Fact>
  reserveOrder(profileId: string, items: number, facts: number): { item: number; fact: number }
  insertFact(fact: Fact, sortOrder?: number): void
  saveFact(fact: Fact): void
  removeFact(id: string): void
}
