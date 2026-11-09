export const itemTypes = ['EXPERIENCE', 'PROJECT', 'EDUCATION'] as const
export const factKinds = ['ACHIEVEMENT', 'RESPONSIBILITY', 'SKILL', 'AWARD', 'CERTIFICATION', 'COURSE', 'LANGUAGE', 'OTHER'] as const
export interface Contact { name: string; email: string; phone: string; location: string; links: { label: string; url: string }[] }
export type ContactInput = Pick<Contact, 'name'> & Partial<Omit<Contact, 'name'>>
export interface ProfileDetails extends Contact { title: string; introduction: string }
export type ProfileInput = ContactInput & { title?: string; introduction?: string }
export interface Profile extends ProfileDetails { id: string; updatedAt: string; revision: number }
export interface ItemDetails {
  type: typeof itemTypes[number]; title: string; organization: string; role: string; location: string
  startDate: string | null; endDate: string | null; summary: string; sortOrder: number
  metadata: { employmentType?: string; technologies?: string[]; url?: string; degree?: string; major?: string; gpa?: string
    startDateText?: string; endDateText?: string; isCurrent?: boolean }
}
export type ItemInput = Pick<ItemDetails, 'type' | 'title'> & Partial<Omit<ItemDetails, 'type' | 'title'>>
export interface ProfileItem extends ItemDetails { id: string; profileId: string; parentItemId: string | null }
export interface FactDetails { kind: typeof factKinds[number]; content: string; tags: string[] }
export type FactInput = Pick<FactDetails, 'kind' | 'content'> & Partial<Omit<FactDetails, 'kind' | 'content'>>
export interface Fact extends FactDetails { id: string; profileId: string; profileItemId: string | null; createdAt: string; updatedAt: string }

export type ProfileStatus = 'DRAFT' | 'READY'
export interface ProfileBaselineV1 {
  profile: ProfileDetails
  items: ProfileItem[]
  facts: Array<Fact & { sortOrder: number }>
}
export interface ProfileBaseline { profileId: string; schemaVersion: 1; snapshot: ProfileBaselineV1; createdAt: string }
export interface ProfileBaselineStatus { profileId: string; status: ProfileStatus; createdAt: string | null }
