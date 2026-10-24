import { AgentError, type AgentModel } from '../../shared/agent'
import type { JobPageSnapshot } from '../../domain/job/job.extractor'
import { jobParts, mergeJobParts } from '../job-import/parts'
import { createTaskBatch } from '../import/batch'
import type { ImportMode } from '../../shared/import'
import { runAgent } from './loop'

/** Source understanding runs without any Job Agent Browser tool discovery or calls. */
export function createCaptureBatch(model: AgentModel, source: JobPageSnapshot, mode: ImportMode) {
  return createTaskBatch(jobParts(source, mode), (prompt, signal, began) => {
    began()
    return runAgent(model, undefined, [{ role: 'user', content: prompt }], signal)
  })
}
export async function runCaptureAgent(model: AgentModel, source: JobPageSnapshot, signal: AbortSignal) {
  try { return mergeJobParts(await createCaptureBatch(model, source, 'single').run(signal, () => {})) }
  catch (error) { if (signal.aborted) throw new AgentError('AGENT_CANCELLED'); throw error }
}
