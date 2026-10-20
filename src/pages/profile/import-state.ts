import { contactFields, contactLink, factDetails, itemDetails, validateItemDates } from '../../domain/candidate/candidate.validation'
import type { FactInput, ItemInput } from '../../domain/candidate/candidate.types'
import type { ConfirmedImport, ContactKey, ImportDraft, ImportSaved } from '../../domain/candidate/import.types'

export function validItem(details: ItemInput): boolean { try { validateItemDates(itemDetails(details)); return true } catch { return false } }
export function validFact(details: FactInput): boolean { try { factDetails(details); return true } catch { return false } }
export function validLink(details: { label: string; url: string }): boolean { try { contactLink(details); return true } catch { return false } }
export function validContact(key: ContactKey, value: string): boolean { try { contactFields[key](value); return true } catch { return false } }
export function changeImportItem(draft: ImportDraft, id: string, details: ItemInput): ImportDraft {
  return { ...draft, items: draft.items.map(item => item.draftId === id && !item.savedId ? { ...item, details, confirmed: false, error: !validItem(details) } : item),
    facts: draft.facts.map(fact => fact.itemDraftId === id ? { ...fact, confirmed: false } : fact) }
}
export function changeImportFact(draft: ImportDraft, id: string, patch: { details?: FactInput; itemDraftId?: string | null }): ImportDraft {
  return { ...draft, facts: draft.facts.map(fact => {
    if (fact.draftId !== id) return fact
    const sourceError = Boolean(fact.sourceError && (!patch.details || patch.details.evidence === fact.details.evidence))
    return { ...fact, ...patch, confirmed: false, sourceError, error: sourceError || !validFact(patch.details ?? fact.details) }
  }) }
}
export function confirmImportItem(draft: ImportDraft, id: string, confirmed: boolean): ImportDraft {
  return { ...draft, items: draft.items.map(item => item.draftId === id ? { ...item, confirmed: confirmed && !item.ignored && !item.error } : item),
    facts: draft.facts.map(fact => !confirmed && fact.itemDraftId === id ? { ...fact, confirmed: false } : fact) }
}
export function ignoreImportItem(draft: ImportDraft, id: string, ignored: boolean): ImportDraft {
  return { ...draft, items: draft.items.map(item => item.draftId === id ? { ...item, ignored, confirmed: false } : item),
    facts: draft.facts.map(fact => fact.itemDraftId === id ? { ...fact, ignored: ignored || fact.ignored, confirmed: false } : fact) }
}
export function parentReady(draft: ImportDraft, id: string | null): boolean {
  if (!id) return true
  return draft.items.some(item => item.draftId === id && !item.ignored && Boolean(item.savedId || (item.confirmed && !item.error)))
}
export function confirmedSelection(draft: ImportDraft, sessionId: string, batchId: string, profileId: string | null): ConfirmedImport {
  return { sessionId, batchId, profileId,
    contact: Object.fromEntries(Object.entries(draft.contact).filter(([key, field]) => field.confirmed && !field.ignored && validContact(key as ContactKey, field.value)).map(([key, field]) => [key, field.value])),
    links: draft.links.filter(link => link.confirmed && !link.ignored && validLink(link)).map(({ draftId, label, url }) => ({ draftId, label, url })),
    items: draft.items.filter(item => item.confirmed && !item.ignored && !item.savedId && !item.error && validItem(item.details)).map(({ draftId, details }) => ({ draftId, details })),
    facts: draft.facts.filter(fact => fact.confirmed && !fact.ignored && !fact.error && validFact(fact.details) && parentReady(draft, fact.itemDraftId)).map(({ draftId, details, itemDraftId }) => ({ draftId, details, itemDraftId, profileItemId: null })) }
}
export function savedSelection(draft: ImportDraft, input: ConfirmedImport, saved: ImportSaved): ImportDraft {
  return { ...draft, contact: Object.fromEntries(Object.entries(draft.contact).map(([key, field]) => [key, Object.hasOwn(input.contact, key) ? { ...field, confirmed: false, ignored: true, saved: true } : field])) as ImportDraft['contact'],
    links: draft.links.filter(link => !input.links.some(entry => entry.draftId === link.draftId)),
    items: draft.items.map(item => saved.itemIds[item.draftId] ? { ...item, savedId: saved.itemIds[item.draftId], confirmed: true } : item),
    facts: draft.facts.filter(fact => !saved.factIds[fact.draftId]) }
}
export function hasPending(draft: ImportDraft): boolean {
  return Object.values(draft.contact).some(field => !field.ignored) || draft.links.some(link => !link.ignored)
    || draft.items.some(item => !item.savedId && !item.ignored) || draft.facts.some(fact => !fact.ignored)
}
