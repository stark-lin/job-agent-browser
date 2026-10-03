import type { Page, PageResult } from '../common/ports'

export const applicationStatuses = ['NOT_STARTED', 'PREPARING', 'APPLIED', 'INTERVIEW', 'OFFER', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const
export type ApplicationStatus = typeof applicationStatuses[number]
export interface CompanyDetails { name: string; domain: string; website: string; logoUrl: string }
export type CompanyInput = Pick<CompanyDetails, 'name'> & Partial<Omit<CompanyDetails, 'name'>>
export interface Company extends CompanyDetails { id: string; normalizedName: string; createdAt: string; updatedAt: string }
export interface JobDetails {
  companyId: string | null; companyNameRaw: string; title: string; description: string; locationText: string
  locations: { text: string; city: string; state: string; country: string; mode: 'ONSITE' | 'HYBRID' | 'REMOTE' }[]
  employmentType: string
  salary: { min: number | null; max: number | null; currency: string; text: string; period: 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' } | null
  requirements: { text: string; type: 'REQUIRED' | 'PREFERRED' | 'OTHER'; keywords: string[] }[]
  notes: string
}
export type JobInput = Pick<JobDetails, 'title' | 'companyNameRaw'> & Partial<Omit<JobDetails, 'title' | 'companyNameRaw'>>
export interface Job extends JobDetails {
  id: string; applicationStatus: ApplicationStatus; savedAt: string; appliedAt: string | null
  closedAt: string | null; archivedAt: string | null; createdAt: string; updatedAt: string
}
export interface SourceDetails { url: string; platform: string; externalId: string; pageTitle: string; cleanedContent: string }
export type SourceInput = Pick<SourceDetails, 'url'> & Partial<Omit<SourceDetails, 'url'>>
export interface JobSource extends SourceDetails { id: string; jobId: string; normalizedUrl: string; fingerprint: string; firstSeenAt: string; lastSeenAt: string }
export interface JobFilter extends Page { status?: ApplicationStatus; archived?: boolean; search?: string }
export interface JobView { job: Job; sources: PageResult<JobSource> }
