import { contactFields, contactLink, factDetails, itemDetails, validateItemDates } from '../../domain/candidate/candidate.validation'
import type { FactInput, ItemInput } from '../../domain/candidate/candidate.types'
import type { ApplyImport, ContactKey, ImportDraft, ImportSaved } from '../../domain/candidate/import.types'

export function validItem(details: ItemInput): boolean { try { validateItemDates(itemDetails(details)); return true } catch { return false } }
export function validFact(details: FactInput): boolean { try { factDetails(details); return true } catch { return false } }
export function validLink(details: { label: string; url: string }): boolean { try { contactLink({ label: details.label, url: details.url }); return true } catch { return false } }
export function validContact(key: ContactKey, value: string): boolean { try { contactFields[key](value); return true } catch { return false } }
export function changeImportItem(draft: ImportDraft, id: string, details: ItemInput): ImportDraft {
  return { ...draft, items: draft.items.map(item => item.draftId === id && !item.savedId ? { ...item, details, error: !validItem(details) } : item) }
}
export function changeImportFact(draft: ImportDraft, id: string, patch: { details?: FactInput; itemDraftId?: string | null }): ImportDraft {
  return { ...draft, facts: draft.facts.map(fact => {
    if (fact.draftId !== id) return fact
    return { ...fact, ...patch, error: !validFact(patch.details ?? fact.details) }
  }) }
}
export function ignoreImportItem(draft: ImportDraft, id: string, ignored: boolean): ImportDraft {
  return { ...draft, items: draft.items.map(item => item.draftId === id ? { ...item, ignored } : item) }
}
export function parentReady(draft: ImportDraft, id: string | null): boolean {
  return !id || draft.items.some(item => item.draftId === id && !item.ignored && Boolean(item.savedId || (!item.error && validItem(item.details))))
}
/** First invalid non-ignored entry blocks the entire submitted subset and identifies its editor. */
export function importError(draft: ImportDraft): string | null {
  for (const [key, field] of Object.entries(draft.contact)) if (!field.ignored && !validContact(key as ContactKey, field.value)) return `contact-${key}`
  for (const link of draft.links) if (!link.ignored && !validLink(link)) return link.draftId
  for (const item of draft.items) if (!item.savedId && !item.ignored && (item.error || !validItem(item.details))) return item.draftId
  for (const fact of draft.facts) {
    if (fact.ignored || draft.items.some(item => item.draftId === fact.itemDraftId && item.ignored)) continue
    if (fact.error || !validFact(fact.details) || !parentReady(draft, fact.itemDraftId)) return fact.draftId
  }
  return null
}
export function importSelection(draft: ImportDraft, sessionId: string, batchId: string, profileId: string | null): ApplyImport {
  if (importError(draft)) throw new Error('INVALID_INPUT')
  return { sessionId, batchId, profileId,
    contact: Object.fromEntries(Object.entries(draft.contact).filter(([, field]) => !field.ignored).map(([key, field]) => [key, field.value])),
    links: draft.links.filter(link => !link.ignored).map(({ draftId, label, url }) => ({ draftId, label, url })),
    items: draft.items.filter(item => !item.ignored && !item.savedId).map(({ draftId, details }) => ({ draftId, details })),
    facts: draft.facts.filter(fact => !fact.ignored && parentReady(draft, fact.itemDraftId)).map(({ draftId, details, itemDraftId }) => ({ draftId, details, itemDraftId, profileItemId: null })) }
}
export function savedSelection(draft: ImportDraft, input: ApplyImport, saved: ImportSaved): ImportDraft {
  return { ...draft, contact: Object.fromEntries(Object.entries(draft.contact).map(([key, field]) => [key, Object.hasOwn(input.contact, key) ? { ...field, ignored: true, saved: true } : field])) as ImportDraft['contact'],
    links: draft.links.filter(link => !input.links.some(entry => entry.draftId === link.draftId)),
    items: draft.items.map(item => saved.itemIds[item.draftId] ? { ...item, savedId: saved.itemIds[item.draftId] } : item),
    facts: draft.facts.filter(fact => !saved.factIds[fact.draftId]) }
}
export function hasPending(draft: ImportDraft): boolean {
  return Object.values(draft.contact).some(field => !field.ignored) || draft.links.some(link => !link.ignored)
    || draft.items.some(item => !item.savedId && !item.ignored) || draft.facts.some(fact => !fact.ignored && !draft.items.some(item => item.draftId === fact.itemDraftId && item.ignored))
}
