import type { JobDetails, SourceDetails } from '../../domain/job/job.types'
import type { JobDraft } from '../../domain/job/job.extractor'
import { sourceDetails } from '../../domain/job/job.validation'
import type { WebSelection } from '../../shared/browser-selection'

export function jobFormSource(kind: 'url' | 'text' | 'pdf', url: string, source: SourceDetails | null, web: WebSelection['source'] | null, text: string): SourceDetails | null {
  if (kind === 'text' && web) return sourceDetails({ url: web.url, platform: new URL(web.url).hostname, externalId: '', pageTitle: web.title, cleanedContent: text })
  return kind === 'url' && url.trim() ? sourceDetails(source?.url === url.trim() ? source : { url: url.trim() }) : null
}

export function emptyJob(): JobDetails {
  return { companyId: null, title: '', companyNameRaw: '', description: '', locationText: '', locations: [],
    employmentType: '', salary: null, requirements: [], notes: '' }
}
/** Arrays and salary are complete fields: do not silently combine unrelated entries. */
export function fillEmptyJob(current: JobDetails, draft: JobDraft): JobDetails {
  const result = { ...current }
  for (const key of ['title', 'companyNameRaw', 'description', 'locationText', 'employmentType', 'notes'] as const) {
    if (!current[key].trim()) result[key] = draft[key]
  }
  if (!current.locations.length) result.locations = draft.locations
  if (!current.requirements.length) result.requirements = draft.requirements
  if (!current.salary) result.salary = draft.salary
  return result
}
