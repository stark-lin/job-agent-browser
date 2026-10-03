export const itemTypes = ['EXPERIENCE', 'PROJECT', 'EDUCATION'] as const
export const factKinds = ['ACHIEVEMENT', 'RESPONSIBILITY', 'SKILL', 'AWARD', 'CERTIFICATION', 'COURSE', 'LANGUAGE', 'OTHER'] as const
export interface Contact { name: string; email: string; phone: string; location: string; links: { label: string; url: string }[] }
export type ContactInput = Pick<Contact, 'name'> & Partial<Omit<Contact, 'name'>>
export interface Profile extends Contact { id: string; updatedAt: string }
export interface ItemDetails {
  type: typeof itemTypes[number]; title: string; organization: string; role: string; location: string
  startDate: string | null; endDate: string | null; summary: string; sortOrder: number
  metadata: { employmentType?: string; technologies?: string[]; url?: string; degree?: string; major?: string; gpa?: string }
}
export type ItemInput = Pick<ItemDetails, 'type' | 'title'> & Partial<Omit<ItemDetails, 'type' | 'title'>>
export interface ProfileItem extends ItemDetails { id: string; profileId: string; parentItemId: string | null }
export interface FactDetails { kind: typeof factKinds[number]; content: string; tags: string[]; evidence: string }
export type FactInput = Pick<FactDetails, 'kind' | 'content'> & Partial<Omit<FactDetails, 'kind' | 'content'>>
export interface Fact extends FactDetails { id: string; profileId: string; profileItemId: string | null; verificationStatus: 'UNVERIFIED' | 'CONFIRMED'; createdAt: string; updatedAt: string }
