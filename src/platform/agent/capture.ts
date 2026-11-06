import { AgentError, type AgentModel } from '../../shared/agent'
import type { JobPageSnapshot } from '../../domain/job/job.extractor'
import { parseJobDraft } from '../../domain/job/job.extraction.validation'
import { JobImportFailure } from '../job-import/errors'
import { jobPrompt } from '../job-import/prompt'
import { runAgent } from './loop'

/** Source understanding runs without any Job Agent Browser tool discovery or calls. */
export async function runCaptureAgent(model: AgentModel, source: JobPageSnapshot, signal: AbortSignal) {
  const response = await runAgent(model, undefined, [{ role: 'user', content: jobPrompt(source) }], signal)
  if (signal.aborted) throw new AgentError('AGENT_CANCELLED')
  let draft
  try { draft = parseJobDraft(JSON.parse(response.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''))) }
  catch { throw new JobImportFailure('JOB_INVALID_OUTPUT') }
  if (![draft.title, draft.companyNameRaw, draft.description].some(text => text.trim())) throw new JobImportFailure('JOB_NO_CONTENT')
  return draft
}
