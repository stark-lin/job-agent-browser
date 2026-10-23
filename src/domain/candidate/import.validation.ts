import * as v from '../common/validation'
import { importContactFields, importContactLinkFields, importFactDetails, importItemDetails } from './candidate.validation'
import type { ApplyImport } from './import.types'

const maybe = <T>(parse: v.Parser<T>): v.Parser<T | undefined> => input => input === undefined ? undefined : parse(input)
export const applyImportInput: v.Parser<ApplyImport> = v.object({
  sessionId: v.id, batchId: v.id, profileId: v.nullable(v.id),
  contact: v.object({ name: maybe(importContactFields.name), email: maybe(importContactFields.email), phone: maybe(importContactFields.phone), location: maybe(importContactFields.location) }),
  links: v.array(v.object({ draftId: v.id, ...importContactLinkFields }), 20),
  items: v.array(v.object({ draftId: v.id, details: importItemDetails }), 200),
  facts: v.array(v.object({ draftId: v.id, itemDraftId: v.nullable(v.id), profileItemId: v.nullable(v.id), details: importFactDetails }), 1000)
})
