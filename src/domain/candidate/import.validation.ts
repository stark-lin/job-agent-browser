import * as v from '../common/validation'
import { contactFields, factDetails, itemDetails } from './candidate.validation'
import type { ApplyImport } from './import.types'

const maybe = <T>(parse: v.Parser<T>): v.Parser<T | undefined> => input => input === undefined ? undefined : parse(input)
export const applyImportInput: v.Parser<ApplyImport> = v.object({
  sessionId: v.id, batchId: v.id, profileId: v.nullable(v.id),
  contact: v.object({ name: maybe(contactFields.name), email: maybe(contactFields.email), phone: maybe(contactFields.phone), location: maybe(contactFields.location) }),
  links: v.array(v.object({ draftId: v.id, label: v.text(100, 1), url: v.url }), 20),
  items: v.array(v.object({ draftId: v.id, details: itemDetails }), 200),
  facts: v.array(v.object({ draftId: v.id, itemDraftId: v.nullable(v.id), profileItemId: v.nullable(v.id), details: factDetails }), 1000)
})
