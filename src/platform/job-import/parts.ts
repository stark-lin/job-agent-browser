import { parseJobDraft } from '../../domain/job/job.extraction.validation'
import type { JobDraft, JobPageSnapshot } from '../../domain/job/job.extractor'
import type { ImportMode } from '../../shared/import'
import type { ImportPart } from '../import/batch'
import { JobImportFailure } from './errors'
import { jobPrompt } from './extractor'

export function parseJobPart(text: string, keys?: readonly string[]): Partial<JobDraft> {
  try {
    const raw: unknown = JSON.parse(text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (keys && Object.keys(raw).some(key => !keys.includes(key)))) throw new Error()
    const draft = parseJobDraft(raw)
    return keys ? Object.fromEntries(Object.entries(draft).filter(([key]) => keys.includes(key))) : draft
  } catch { throw new JobImportFailure('JOB_INVALID_OUTPUT') }
}
export function jobParts(snapshot: JobPageSnapshot, mode: ImportMode): ImportPart<Partial<JobDraft>>[] {
  const prompt = jobPrompt(snapshot)
  if (mode === 'single') return [{ id: 'single', prompt, parse: text => parseJobPart(text) }]
  return [
    { id: 'basics' as const, keys: ['title', 'companyNameRaw', 'locationText', 'locations', 'employmentType', 'salary'] },
    { id: 'description' as const, keys: ['description'] },
    { id: 'requirements' as const, keys: ['requirements'] }
  ].map(({ id, keys }) => ({ id, prompt: `This is the ${id} extraction group. Return ONLY these top-level fields: ${keys.join(', ')}. All other fields belong to other requests. Apply the rules below only to your fields. If not a job return {}.\n${prompt}`,
    parse: text => parseJobPart(text, keys) }))
}
export function mergeJobParts(parts: Partial<JobDraft>[]): JobDraft {
  const draft = parseJobDraft(Object.assign({}, ...parts))
  if (![draft.title, draft.companyNameRaw, draft.description].some(text => text.trim())) throw new JobImportFailure('JOB_NO_CONTENT')
  return draft
}
