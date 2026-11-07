import { importContactLinkFields, importItemFields, itemMetadataFields, importFactFields, validateItemDates } from '../../domain/candidate/candidate.validation'
import type { Parser } from '../../domain/common/validation'
import type { FactInput, ItemInput } from '../../domain/candidate/candidate.types'

/** Field paths also drive focus, so format errors never point at an unrelated control. */
function fieldErrors(fields: Record<string, Parser<unknown>>, value: object): Record<string, boolean> {
  return Object.fromEntries(Object.entries(fields).flatMap(([key, parse]) => {
    try { parse((value as Record<string, unknown>)[key]); return [] } catch { return [[key, true]] }
  }))
}
export function importItemErrors(details: ItemInput): Record<string, boolean> {
  const errors = fieldErrors(importItemFields, details)
  delete errors.metadata
  Object.assign(errors, fieldErrors(itemMetadataFields, details.metadata ?? {}))
  if (!errors.startDateText && !errors.endDateText && !errors.startDate && !errors.endDate) {
    try { validateItemDates({ startDate: details.startDate ?? null, endDate: details.endDate ?? null, metadata: details.metadata }) } catch {
      errors.startDateText = true; errors.endDateText = true
    }
  }
  return errors
}
export function importLinkErrors(details: { label: string; url: string }): Record<string, boolean> { return fieldErrors(importContactLinkFields, details) }
export function importFactErrors(details: FactInput): Record<string, boolean> { return fieldErrors(importFactFields, details) }
