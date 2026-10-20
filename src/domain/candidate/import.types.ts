import type { Contact, Fact, FactInput, ItemInput, Profile, ProfileItem } from './candidate.types'

export type ContactKey = 'name' | 'email' | 'phone' | 'location'
export interface ImportFact { draftId: string; itemDraftId: string | null; profileItemId: string | null; details: FactInput }
export interface ImportItem { draftId: string; details: ItemInput }
export interface ImportLink { draftId: string; label: string; url: string }
export interface ConfirmedImport {
  sessionId: string; batchId: string; profileId: string | null
  contact: Partial<Pick<Contact, ContactKey>>; links: ImportLink[]; items: ImportItem[]; facts: ImportFact[]
}
export interface ImportSaved {
  profile: Profile; items: ProfileItem[]; facts: Fact[]
  itemIds: Record<string, string>; factIds: Record<string, string>
}
export interface DraftFact extends ImportFact { confirmed: boolean; ignored: boolean; error: boolean; sourceError?: boolean }
export interface DraftItem extends ImportItem { confirmed: boolean; ignored: boolean; error: boolean; savedId: string | null }
export interface ImportDraft {
  contact: Record<ContactKey, { value: string; confirmed: boolean; ignored: boolean; saved?: boolean }>
  links: (ImportLink & { confirmed: boolean; ignored: boolean })[]
  items: DraftItem[]; facts: DraftFact[]
}
