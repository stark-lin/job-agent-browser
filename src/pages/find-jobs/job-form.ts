import type { JobDetails } from '../../domain/job/job.types'
import type { JobDraft } from '../../domain/job/job.extractor'

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
