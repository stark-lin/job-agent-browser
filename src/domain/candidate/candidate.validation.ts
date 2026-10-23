import * as v from '../common/validation'
import { fail } from '../common/errors'
import { factKinds, itemTypes } from './candidate.types'

export const contactFields = { name: v.text(300, 1), email: v.text(320), phone: v.text(100), location: v.text(1000) }
export const contactLink = v.object({ label: v.text(100, 1), url: v.url })
export const contact = v.object({ name: contactFields.name, email: v.optionalText(320), phone: v.optionalText(100), location: v.optionalText(1000), links: v.optional(v.array(contactLink, 20), []) })
export function partialDate(input: unknown): string {
  const result = v.text(10)(input)
  if (!result) return result
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(result)) fail('INVALID_INPUT')
  v.date(result.length === 4 ? `${result}-01-01` : result.length === 7 ? `${result}-01` : result)
  return result
}
export const itemMetadataFields = { employmentType: v.optionalText(100), technologies: v.optional(v.array(v.text(100, 1), 100), []), url: v.optionalUrl, degree: v.optionalText(200), major: v.optionalText(200), gpa: v.optionalText(50),
  startDateText: v.optional(partialDate, ''), endDateText: v.optional(partialDate, ''), isCurrent: v.optional(v.boolean, false) }
const metadata = v.object(itemMetadataFields)
const itemFields = {
  type: v.choice(itemTypes), title: v.text(500, 1), organization: v.optionalText(300), role: v.optionalText(300), location: v.optionalText(),
  startDate: v.optional(v.nullable(v.date), null), endDate: v.optional(v.nullable(v.date), null), summary: v.optionalText(20_000),
  sortOrder: v.optional(v.integer(0, 1_000_000), 0), metadata: v.optional(metadata, metadata({}))
}
export const itemDetails = v.object(itemFields)
const factFields = { kind: v.choice(factKinds), content: v.text(20_000, 1), tags: v.optional(v.array(v.text(100, 1), 100), []), evidence: v.optionalText(20_000) }
export const factDetails = v.object(factFields)
// Imported records may be incomplete; retain format/length validation without inventing missing text.
export const importContactFields = { name: v.optionalText(300), email: v.optionalText(320), phone: v.optionalText(100), location: v.optionalText(1000) }
export const importContactLinkFields = { label: v.optionalText(100), url: v.optionalUrl }
export const importContactLink = v.object(importContactLinkFields)
export const importContact = v.object({ ...importContactFields, links: v.optional(v.array(importContactLink, 20), []) })
export const importItemFields = { ...itemFields, title: v.optionalText(500) }
export const importItemDetails = v.object(importItemFields)
export const importFactFields = { ...factFields, content: v.optionalText(20_000) }
export const importFactDetails = v.object(importFactFields)
export function validateItemDates(item: { startDate: string | null; endDate: string | null; metadata?: { startDateText?: string; endDateText?: string; isCurrent?: boolean } }): void {
  if (item.startDate && item.endDate && item.startDate > item.endDate) fail('INVALID_INPUT')
  const start = item.metadata?.startDateText || item.startDate, end = item.metadata?.endDateText || item.endDate
  if (item.metadata?.isCurrent && (end || item.endDate)) fail('INVALID_INPUT')
  const earliest = start?.length === 4 ? `${start}-01-01` : start?.length === 7 ? `${start}-01` : start
  if (earliest && end && earliest > end.padEnd(10, '9')) fail('INVALID_INPUT')
  for (const [text, day] of [[start, item.startDate], [end, item.endDate]]) {
    if (text && day && (text.length !== 10 || text !== day)) fail('INVALID_INPUT')
  }
}
