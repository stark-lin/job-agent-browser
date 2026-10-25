import { object, uuid, text, page } from './business-schema'
import type { JsonSchema } from '../../shared/tools/tool.types'
import { factKinds, itemTypes } from '../../domain/candidate/candidate.types'

const array = (items: JsonSchema, maxItems: number) => ({ type: 'array', items, maxItems })
const nullable = (schema: JsonSchema) => ({ anyOf: [schema, { type: 'null' }] })
const choices = (values: readonly string[]) => ({ type: 'string', enum: [...values] })
const revision = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }
const contact = { name: text(300, 1), email: text(320), phone: text(100), location: text(1000), introduction: text(2000),
  links: array(object({ label: text(100, 1), url: text(4096, 1) }), 20) }
const metadata = { employmentType: text(100), technologies: array(text(100, 1), 100), url: text(4096), degree: text(200), major: text(200), gpa: text(50),
  startDateText: text(10), endDateText: text(10), isCurrent: { type: 'boolean' } }
const item = { title: text(500, 1), organization: text(300), role: text(300), location: text(1000), startDate: nullable(text(10, 10)), endDate: nullable(text(10, 10)),
  summary: text(20000), sortOrder: { type: 'integer', minimum: 0, maximum: 1000000 }, metadata: object(metadata, []) }
const fact = { kind: choices(factKinds), content: text(20000, 1), tags: array(text(100, 1), 100), evidence: text(20000) }
const write = { requestId: uuid, profileId: uuid, expectedRevision: revision }
const changes = (fields: Record<string, JsonSchema>) => ({ ...object(fields, []), minProperties: 1 })
export const profileSchemas = {
  create: object({ requestId: uuid, details: object(contact, ['name']) }),
  update: object({ id: uuid, requestId: uuid, expectedRevision: revision, changes: changes(contact) }),
  items: object({ profileId: uuid, ...page }, ['profileId']),
  addItem: object({ ...write, parentItemId: nullable(uuid), details: object({ type: choices(itemTypes), ...item }, ['type', 'title']) }, Object.keys(write).concat('details')),
  updateItem: object({ ...write, id: uuid, changes: changes({ ...item, parentItemId: nullable(uuid) }) }),
  addFact: object({ ...write, profileItemId: nullable(uuid), details: object(fact, ['kind', 'content']) }, Object.keys(write).concat('details')),
  updateFact: object({ ...write, id: uuid, changes: changes({ ...fact, profileItemId: nullable(uuid) }) })
}
