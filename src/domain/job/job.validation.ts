import * as v from '../common/validation'
import { applicationStatuses } from './job.types'

export const companyDetails = v.object({ name: v.text(300, 1), domain: v.optionalText(253), website: v.optionalUrl, logoUrl: v.optionalUrl })
const location = v.object({ text: v.text(1000), city: v.text(200), state: v.text(200), country: v.text(200), mode: v.choice(['ONSITE', 'HYBRID', 'REMOTE']) })
const salary = v.object({ min: v.nullable(v.number), max: v.nullable(v.number), currency: v.text(3, 3), text: v.text(1000), period: v.choice(['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR']) })
const requirement = v.object({ text: v.text(4000, 1), type: v.choice(['REQUIRED', 'PREFERRED', 'OTHER']), keywords: v.array(v.text(100, 1), 50) })
export const jobDetails = v.object({
  companyId: v.optionalId, companyNameRaw: v.text(300, 1), title: v.text(500, 1), description: v.optionalText(100_000),
  locationText: v.optionalText(), locations: v.optional(v.array(location, 50), []), employmentType: v.optionalText(100),
  salary: v.optional(v.nullable(salary), null), requirements: v.optional(v.array(requirement), []), notes: v.optionalText(20_000)
})
export const sourceDetails = v.object({ url: v.url, platform: v.optionalText(100), externalId: v.optionalText(500), pageTitle: v.optionalText(1000), cleanedContent: v.optionalText(200_000) })
export const jobFilter = v.object({ ...v.pageFields, status: v.optional(v.nullable(v.choice(applicationStatuses)), null), archived: v.optional(v.boolean, false), search: v.optionalText(200) })
