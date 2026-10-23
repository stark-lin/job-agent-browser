import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Checkbox, FormField, SectionCard, Select, StatusMessage, TextInput } from '../../shared/ui'
import type { Profile } from '../../domain/candidate/candidate.types'
import type { DraftFact, ImportDraft } from '../../domain/candidate/import.types'
import { contactKeys, FactFields, ItemFields } from './ProfileFields'
import { changeImportFact, changeImportItem, ignoreImportItem, parentReady, validContact, validLink } from './import-state'

export function ImportReview({ draft, setDraft, profile, disabled }: {
  draft: ImportDraft; setDraft: Dispatch<SetStateAction<ImportDraft | null>>; profile: Profile | null; disabled: boolean
}) {
  const { t } = useTranslation()
  const change = (update: (draft: ImportDraft) => ImportDraft) => setDraft(previous => previous && update(previous))
  const renderFact = (fact: DraftFact) => {
    const ready = parentReady(draft, fact.itemDraftId), ignoredParent = draft.items.some(item => item.draftId === fact.itemDraftId && item.ignored)
    return <SectionCard data-import-id={fact.draftId} key={fact.draftId} title={t($ => $.profile.kinds[fact.details.kind])}><div className="profile-stack">
      <FormField label={t($ => $.profile.belongsTo)}>{props => <Select {...props} value={fact.itemDraftId ?? ''} disabled={disabled || fact.ignored} onChange={event => change(draft => changeImportFact(draft, fact.draftId, { itemDraftId: event.target.value || null }))}><option value="">{t($ => $.profile.independent)}</option>{draft.items.filter(item => !item.ignored).map(item => <option key={item.draftId} value={item.draftId}>{item.details.title || t($ => $.profile.types[item.details.type])}</option>)}</Select>}</FormField>
      <FactFields showEvidence={false} value={fact.details} disabled={disabled || fact.ignored || ignoredParent} onChange={details => change(draft => changeImportFact(draft, fact.draftId, { details }))} />
      {fact.error && <StatusMessage tone="error">{t($ => $.profile.invalidFact)}</StatusMessage>}
      {!ready && !fact.ignored && <StatusMessage>{t($ => $.profile.parentRequired)}</StatusMessage>}
      <Checkbox label={t($ => $.profile.ignore)} checked={fact.ignored} disabled={disabled || ignoredParent} onChange={event => change(draft => ({ ...draft, facts: draft.facts.map(entry => entry.draftId === fact.draftId ? { ...entry, ignored: event.target.checked } : entry) }))} />
    </div></SectionCard>
  }
  return <div className="profile-stack">
    <StatusMessage>{t($ => $.profile.reviewHelp)}</StatusMessage>
    <SectionCard title={t($ => $.profile.basic)}><div className="profile-stack">{contactKeys.filter(key => !draft.contact[key].saved).map(key => {
      const field = draft.contact[key], valid = validContact(key, field.value)
      return <div className="profile-stack" key={key} data-import-id={`contact-${key}`}>
        <FormField label={t($ => $.profile[key])} help={t($ => $.profile.existing, { value: profile?.[key] || t($ => $.profile.emptyValue) })} error={!valid && !field.ignored ? t($ => $.profile.invalid) : undefined}>{props => <TextInput {...props} value={field.value} maxLength={key === 'name' ? 300 : key === 'email' ? 320 : key === 'phone' ? 100 : 1000} disabled={disabled || field.ignored} onChange={event => change(draft => ({ ...draft, contact: { ...draft.contact, [key]: { ...field, value: event.target.value } } }))} />}</FormField>
        <div className="profile-actions"><Checkbox label={t($ => $.profile.ignore)} checked={field.ignored} disabled={disabled} onChange={event => change(draft => ({ ...draft, contact: { ...draft.contact, [key]: { ...field, ignored: event.target.checked } } }))} /></div>
      </div>
    })}</div></SectionCard>
    {draft.links.map(link => <SectionCard data-import-id={link.draftId} key={link.draftId} title={t($ => $.profile.links)}><div className="profile-stack">
      <div className="profile-fields">{(['label', 'url'] as const).map(key => <FormField key={key} label={t($ => $.profile[key])}>{props => <TextInput {...props} value={link[key]} maxLength={key === 'label' ? 100 : 4096} disabled={disabled || link.ignored} onChange={event => change(draft => ({ ...draft, links: draft.links.map(entry => entry.draftId === link.draftId ? { ...entry, [key]: event.target.value } : entry) }))} />}</FormField>)}</div>
      {!validLink(link) && !link.ignored && <StatusMessage tone="error">{t($ => $.profile.invalid)}</StatusMessage>}
      <Checkbox label={t($ => $.profile.ignore)} checked={link.ignored} disabled={disabled} onChange={event => change(draft => ({ ...draft, links: draft.links.map(entry => entry.draftId === link.draftId ? { ...entry, ignored: event.target.checked } : entry) }))} />
    </div></SectionCard>)}
    {draft.items.filter(item => !item.savedId || draft.facts.some(fact => fact.itemDraftId === item.draftId)).map(item => <SectionCard data-import-id={item.draftId} key={item.draftId} title={item.details.title || t($ => $.profile.types[item.details.type])}><div className="profile-stack">
      {item.savedId ? <Badge tone="success">{t($ => $.profile.savedEntry)}</Badge> : <>
        <ItemFields value={item.details} disabled={disabled || item.ignored} onChange={details => change(draft => changeImportItem(draft, item.draftId, details))} />
        {item.error && !item.ignored && <StatusMessage tone="error">{t($ => $.profile.invalid)}</StatusMessage>}
        <Checkbox label={t($ => $.profile.ignore)} checked={item.ignored} disabled={disabled} onChange={event => change(draft => ignoreImportItem(draft, item.draftId, event.target.checked))} />
      </>}
      <div className="profile-facts">{draft.facts.filter(fact => fact.itemDraftId === item.draftId).map(renderFact)}</div>
    </div></SectionCard>)}
    <SectionCard title={t($ => $.profile.independent)}><div className="profile-stack">{draft.facts.filter(fact => !fact.itemDraftId).map(renderFact)}</div></SectionCard>
  </div>
}
