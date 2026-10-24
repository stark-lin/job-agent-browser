import type { JobExtractor } from '../../domain/job/job.extractor'
import type { AgentModel } from '../../shared/agent'
import { runCaptureAgent } from '../agent/capture'

export function createJobExtractor(model: AgentModel): JobExtractor {
  return { extract: (snapshot, signal) => runCaptureAgent(model, snapshot, signal) }
}
