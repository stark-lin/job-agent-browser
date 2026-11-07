import { resumeFailures } from '../../shared/agent/resume-policy'
import type { JsonSchema } from '../../shared/tools/tool.types'

export const uuid = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' }
export const object = (properties: JsonSchema, required = Object.keys(properties)): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false })
const text = (maxLength: number, minLength = 0) => ({ type: 'string', maxLength, minLength })
export const schemas = {
  start: object({ requestId: uuid, jobId: uuid, profileId: uuid, targetWordCount: { type: 'integer', minimum: 100, maximum: 5000 },
    model: object({ providerId: text(100, 1), modelId: text(200, 1) }) }, ['requestId', 'jobId', 'profileId']),
  run: object({ runId: uuid }),
  fail: object({ runId: uuid, error: { type: 'string', enum: [...resumeFailures] } }),
  context: object({ runId: uuid }),
  attach: object({ runId: uuid, requestId: uuid, ownerRuntimeId: uuid }),
  facts: object({ runId: uuid, offset: { type: 'integer', minimum: 0, maximum: 1000000 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['runId']),
  rewrite: object({ runId: uuid, bulletId: uuid, text: text(20000, 1), expectedRevision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, requestId: uuid }),
  artifact: object({ artifactId: uuid })
}
