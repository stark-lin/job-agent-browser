import * as v from '../common/validation'
import { fail } from '../common/errors'
import { jobDetailFields } from './job.validation'
import type { JobDraft } from './job.extractor'

const { companyId: _companyId, ...fields } = jobDetailFields
const draft = v.object({ ...fields, title: v.optionalText(500), companyNameRaw: v.optionalText(300) })
export function parseJobDraft(input: unknown): JobDraft {
  const result = draft(input)
  if (result.salary && result.salary.min !== null && result.salary.max !== null && result.salary.min > result.salary.max) fail('INVALID_INPUT')
  return result
}
