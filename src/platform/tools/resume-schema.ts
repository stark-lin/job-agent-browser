import type { JsonSchema } from '../../shared/tools/tool.types'

export const uuid = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' }
export const object = (properties: JsonSchema, required = Object.keys(properties)): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false })
const text = (maxLength: number, minLength = 0) => ({ type: 'string', maxLength, minLength })
const array = (items: JsonSchema, maxItems: number, minItems = 0) => ({ type: 'array', items, maxItems, minItems })
const statement = object({ id: uuid, text: text(20000, 1), factIds: array(uuid, 1000, 1) })
const entry = object({ profileItemId: uuid, bullets: array(statement, 100) })
export const writing = object({ summary: { anyOf: [statement, { type: 'null' }] }, experience: array(entry, 200), projects: array(entry, 200),
  education: array(entry, 200), skills: array(statement, 200) })
export const schemas = {
  start: object({ requestId: uuid, jobId: uuid, profileId: uuid, targetWordCount: { type: 'integer', minimum: 100, maximum: 5000 } }, ['requestId', 'jobId', 'profileId']),
  run: object({ runId: uuid }),
  context: object({ runId: uuid, section: { type: 'string', enum: ['context', 'progress', 'draft', 'polished'] } }, ['runId']),
  facts: object({ runId: uuid, offset: { type: 'integer', minimum: 0, maximum: 1000000 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['runId']),
  scores: object({ runId: uuid, language: { type: 'string', enum: ['en', 'zh-CN'] }, scores: array(object({ factId: uuid,
    score: { type: 'integer', minimum: 0, maximum: 100 }, reason: text(512) }), 1000) }),
  gate: object({ runId: uuid, gate: object({ passed: { type: 'boolean' }, reason: text(4000), missingRequirements: array(text(1000, 1), 100) }) }),
  selection: object({ runId: uuid, selection: object({ factIds: array(uuid, 1000, 1), itemIds: array(uuid, 200), wordBudget: { type: 'integer', minimum: 100, maximum: 5000 } }) }),
  writing: object({ runId: uuid, writing }),
  artifact: object({ artifactId: uuid })
}
