import * as v from '../common/validation'
import { fail } from '../common/errors'
import { factKinds, itemTypes } from './candidate.types'

export const contact = v.object({ name: v.text(300, 1), email: v.optionalText(320), phone: v.optionalText(100), location: v.optionalText(1000), links: v.optional(v.array(v.object({ label: v.text(100, 1), url: v.url }), 20), []) })
const metadata = v.object({ employmentType: v.optionalText(100), technologies: v.optional(v.array(v.text(100, 1), 100), []), url: v.optionalUrl, degree: v.optionalText(200), major: v.optionalText(200), gpa: v.optionalText(50) })
export const itemDetails = v.object({
  type: v.choice(itemTypes), title: v.text(500, 1), organization: v.optionalText(300), role: v.optionalText(300), location: v.optionalText(),
  startDate: v.optional(v.nullable(v.date), null), endDate: v.optional(v.nullable(v.date), null), summary: v.optionalText(20_000),
  sortOrder: v.optional(v.integer(0, 1_000_000), 0), metadata: v.optional(metadata, metadata({}))
})
export const factDetails = v.object({ kind: v.choice(factKinds), content: v.text(20_000, 1), tags: v.optional(v.array(v.text(100, 1), 100), []), evidence: v.optionalText(20_000) })
export function validateItemDates(item: { startDate: string | null; endDate: string | null }): void {
  if (item.startDate && item.endDate && item.startDate > item.endDate) fail('INVALID_INPUT')
}
