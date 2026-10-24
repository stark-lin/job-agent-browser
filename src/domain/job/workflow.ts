import { fail } from '../common/errors'
import { jobDetailFields, jobDetails } from './job.validation'
import type { JobDetails } from './job.types'

/** Stable capture/update contract. Source reading and interpretation belong to the host Agent. */
export const requiredJobFields = ['title', 'companyNameRaw'] as const
export const persistableJobFields = Object.freeze(Object.keys(jobDetailFields) as (keyof JobDetails)[])
export function parseJobChanges(input: unknown): Partial<JobDetails> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT')
  const fields = Object.keys(input)
  if (!fields.length || fields.some(key => !persistableJobFields.includes(key as keyof JobDetails))) fail('INVALID_INPUT')
  const seed: JobDetails = jobDetails({ title: '_', companyNameRaw: '_' })
  const checked = jobDetails({ ...seed, ...input })
  return Object.fromEntries(fields.map(key => [key, checked[key as keyof JobDetails]]))
}
