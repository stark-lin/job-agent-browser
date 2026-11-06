import type { JsonSchema } from '../../shared/tools/tool.types'

export const uuid = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' }
export const object = (properties: JsonSchema, required = Object.keys(properties)): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false })
const text = (maxLength: number, minLength = 0) => ({ type: 'string', maxLength, minLength })
const array = (items: JsonSchema, maxItems: number, minItems = 0) => ({ type: 'array', items, maxItems, minItems })
const statement = object({ text: text(20000, 1), factIds: array(uuid, 1000, 1) })
const entry = object({ profileItemId: uuid, bullets: array(statement, 100) })
export const schemas = {
  start: object({ requestId: uuid, jobId: uuid, profileId: uuid, targetWordCount: { type: 'integer', minimum: 100, maximum: 5000 },
    model: object({ providerId: text(100, 1), modelId: text(200, 1) }) }, ['requestId', 'jobId', 'profileId']),
  run: object({ runId: uuid }),
  fail: object({ runId: uuid, error: { type: 'string', enum: ['AGENT_PROTOCOL_ERROR', 'AGENT_STEP_LIMIT', 'AGENT_TIMEOUT',
    'AI_AUTH_FAILED', 'AI_RATE_LIMITED', 'AI_PROVIDER_FAILED', 'AI_CONNECT_FAILED', 'AUDIT_UNAVAILABLE', 'VALIDATION_FAILED'] } }),
  context: object({ runId: uuid, section: { type: 'string', enum: ['context', 'progress', 'draft', 'polished', 'assembled'] } }, ['runId']),
  facts: object({ runId: uuid, offset: { type: 'integer', minimum: 0, maximum: 1000000 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['runId']),
  optimization: object({ runId: uuid, optimization: object({
    language: { type: 'string', enum: ['en', 'zh-CN'] }, summary: { anyOf: [statement, { type: 'null' }] },
    entries: array(entry, 200), skills: array(statement, 200)
  }) }),
  artifact: object({ artifactId: uuid })
}
