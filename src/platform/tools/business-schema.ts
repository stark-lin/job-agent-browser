import type { JsonSchema } from '../../shared/tools/tool.types'
import { applicationStatuses } from '../../domain/job/job.types'
export { uuid, object } from './resume-schema'
import { uuid, object } from './resume-schema'

export const text = (maxLength: number, minLength = 0) => ({ type: 'string', minLength, maxLength })
const array = (items: JsonSchema, maxItems: number) => ({ type: 'array', items, maxItems })
const nullable = (schema: JsonSchema) => ({ anyOf: [schema, { type: 'null' }] })
const choices = (values: readonly string[]) => ({ type: 'string', enum: [...values] })
export const page = { limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0, maximum: 1000000 } }
export const timestamp = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' }
export const jobFields = {
  title: text(500, 1), companyNameRaw: text(300, 1), companyId: nullable(uuid), description: text(100000), locationText: text(1000),
  locations: array(object({ text: text(1000), city: text(200), state: text(200), country: text(200), mode: choices(['ONSITE', 'HYBRID', 'REMOTE']) }), 50),
  employmentType: text(100), salary: nullable(object({ min: nullable({ type: 'number', minimum: 0 }), max: nullable({ type: 'number', minimum: 0 }),
    currency: text(3, 3), text: text(1000), period: choices(['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR']) })),
  requirements: array(object({ text: text(4000, 1), type: choices(['REQUIRED', 'PREFERRED', 'OTHER']), keywords: array(text(100, 1), 50) }), 200), notes: text(20000)
}
export const jobSchemas = {
  list: object({ ...page, search: text(200), archived: { type: 'boolean' }, status: choices(applicationStatuses) }, []),
  import: object({ requestId: uuid, details: object(jobFields, ['title', 'companyNameRaw']), source: nullable(object({ url: text(4096, 1),
    platform: text(100), externalId: text(500), pageTitle: text(1000), cleanedContent: text(200000) }, ['url'])) }, ['requestId', 'details']),
  update: object({ id: uuid, changes: { ...object(jobFields, []), minProperties: 1 } })
}
export const applicationSchemas = {
  get: object({ jobId: uuid }),
  status: object({ jobId: uuid, status: choices(applicationStatuses) }),
  events: object({ jobId: uuid, ...page }, ['jobId']),
  note: object({ jobId: uuid, requestId: uuid, text: text(20000, 1) }),
  schedule: object({ jobId: uuid, requestId: uuid, type: choices(['INTERVIEW', 'DEADLINE', 'FOLLOW_UP']), title: text(500, 1),
    description: text(20000), startsAt: timestamp, endsAt: nullable(timestamp) }, ['jobId', 'requestId', 'type', 'title', 'startsAt']),
  reschedule: object({ jobId: uuid, id: uuid, startsAt: timestamp, endsAt: nullable(timestamp) }, ['jobId', 'id', 'startsAt'])
}
