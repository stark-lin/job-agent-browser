import type { composeBackend } from '../database/backend'
import { businessTool } from './business'
import { jobSchemas } from './business-schema'

export function createJobTools(backend: ReturnType<typeof composeBackend>) {
  return [
    businessTool(backend, 'job.import', 'Persist an already-understood structured job. This tool does not fetch, browse, parse or invoke AI. Retry the same payload with the same requestId.',
      jobSchemas.import, true, ({ requestId, ...input }) => backend.jobs.saveJob(input, String(requestId)), undefined, 1048576),
    businessTool(backend, 'job.update', 'Update only the specified saved job detail fields. Application status and sources are separate capabilities.',
      jobSchemas.update, true, input => backend.jobs.patchDetails(input), 'id', 1048576)
  ]
}
