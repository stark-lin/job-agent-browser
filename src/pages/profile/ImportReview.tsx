import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionRow, Badge, Button, Checkbox, DetailsList, FormField, SectionCard, Select, StatusMessage, TextArea, TextInput } from '../../shared/ui'
import type { Profile } from '../../domain/candidate/candidate.types'
import type { DraftFact, ImportDraft } from '../../domain/candidate/import.types'
import { basicKeys, FactFields, ItemFields } from '../../app/profile-editor/ProfileFields'
import { changeImportFact, changeImportItem, ignoreImportItem, parentReady, validContact, validLink, importLinkErrors } from './import-state'

export function ImportReview({ draft, setDraft, profile, disabled }: {
  draft: ImportDraft; setDraft: Dispatch<SetStateAction<ImportDraft | null>>; profile: Profile | null; disabled: boolean
}) {
  const { t } = useTranslation()
  const change = (update: (draft: ImportDraft) => ImportDraft) => setDraft(previous => previous && update(previous))
  const itemKeys = ['title', 'organization', 'role', 'location', 'summary'] as const
  const mappedItems = draft.items.filter(item => !item.savedId && !item.ignored)
  const renderFact = (fact: DraftFact) => {
    const ready = parentReady(draft, fact.itemDraftId), ignoredParent = draft.items.some(item => item.draftId === fact.itemDraftId && item.ignored)
    return <SectionCard data-import-id={fact.draftId} key={fact.draftId} title={t($ => $.profile.kinds[fact.details.kind])}><div className="profile-stack">
      <FormField label={t($ => $.profile.belongsTo)}>{props => <Select {...props} value={fact.itemDraftId ?? ''} disabled={disabled || fact.ignored} onChange={event => change(draft => changeImportFact(draft, fact.draftId, { itemDraftId: event.target.value || null }))}><option value="">{t($ => $.profile.independent)}</option>{draft.items.filter(item => !item.ignored).map(item => <option key={item.draftId} value={item.draftId}>{item.details.title || t($ => $.profile.types[item.details.type])}</option>)}</Select>}</FormField>
      <FactFields review value={fact.details} disabled={disabled || fact.ignored || ignoredParent} onChange={details => change(draft => changeImportFact(draft, fact.draftId, { details }))} />
      {fact.error && <StatusMessage tone="error">{t($ => $.profile.formatError)}</StatusMessage>}
      {!ready && !fact.ignored && <StatusMessage>{t($ => $.profile.parentRequired)}</StatusMessage>}
      <Checkbox label={t($ => $.profile.ignore)} checked={fact.ignored} disabled={disabled || ignoredParent} onChange={event => change(draft => ({ ...draft, facts: draft.facts.map(entry => entry.draftId === fact.draftId ? { ...entry, ignored: event.target.checked } : entry) }))} />
    </div></SectionCard>
  }
  return <div className="profile-stack">
    <StatusMessage>{t($ => $.profile.reviewHelp)}</StatusMessage>
    {draft.unmapped?.map(row => {
      const discard = (value: ImportDraft) => ({ ...value, unmapped: value.unmapped?.filter(entry => entry.draftId !== row.draftId) })
      return <SectionCard key={row.draftId} title={t($ => $.profile.unmapped)}><div className="profile-stack">
        <DetailsList items={[{ label: t($ => $.profile.sourcePosition, { ...row.source }), value: row.text }]} />
        <FormField label={t($ => $.profile.mapField)}>{props => <Select {...props} value="" disabled={disabled} onChange={event => {
          const target = event.target.value
          const key = basicKeys.find(key => key === target)
          if (key) {
            change(value => ({ ...discard(value), contact: { ...value.contact, [key]: { value: row.text, ignored: false } } }))
            return
          }
          const [id, field] = target.split('/')
          const item = mappedItems.find(item => item.draftId === id), itemKey = itemKeys.find(key => key === field)
          if (item && itemKey) change(value => changeImportItem(discard(value), id, { ...item.details, [itemKey]: row.text }))
        }}>
          <option value="">{t($ => $.profile.mapField)}</option>
          {basicKeys.filter(key => !draft.contact[key].saved && !draft.contact[key].value.trim()).map(key =>
            <option key={key} value={key}>{t($ => $.profile[key])}</option>)}
          {mappedItems.map(item => <optgroup key={item.draftId} label={item.details.title || t($ => $.profile.types[item.details.type])}>
            {itemKeys.filter(key => !item.details[key]?.trim()).map(key => <option key={key} value={`${item.draftId}/${key}`}>{t($ => $.profile[key])}</option>)}
          </optgroup>)}
        </Select>}</FormField>
        <ActionRow><Button disabled={disabled} onClick={() => change(value => ({ ...discard(value), facts: [...value.facts, {
          draftId: row.draftId, source: row.source, details: { kind: 'OTHER', content: row.text }, ignored: false, error: false, itemDraftId: null, profileItemId: null
        }] }))}>{t($ => $.profile.addFact)}</Button>
        <Button disabled={disabled} onClick={() => change(discard)}>{t($ => $.profile.ignore)}</Button></ActionRow>
      </div></SectionCard>
    })}

    <SectionCard title={t($ => $.profile.basic)}><div className="profile-stack">{basicKeys.filter(key => !draft.contact[key].saved).map(key => {
      const field = draft.contact[key], valid = validContact(key, field.value), Input = key === 'introduction' ? TextArea : TextInput
      return <div className="profile-stack" key={key} data-import-id={`contact-${key}`}>
        <FormField label={t($ => $.profile[key])} help={t($ => $.profile.existing, { value: profile?.[key] || t($ => $.profile.emptyValue) })} error={!valid && !field.ignored ? t($ => $.profile.formatError) : undefined}>{props => <Input {...props} value={field.value} maxLength={key === 'name' ? 300 : key === 'email' ? 320 : key === 'phone' ? 100 : key === 'introduction' ? 2000 : 1000} disabled={disabled || field.ignored} onChange={event => change(draft => ({ ...draft, contact: { ...draft.contact, [key]: { ...field, value: event.target.value } } }))} />}</FormField>
        <div><Checkbox label={t($ => $.profile.ignore)} checked={field.ignored} disabled={disabled} onChange={event => change(draft => ({ ...draft, contact: { ...draft.contact, [key]: { ...field, ignored: event.target.checked } } }))} /></div>
      </div>
    })}</div></SectionCard>
    {draft.links.map(link => <SectionCard data-import-id={link.draftId} key={link.draftId} title={t($ => $.profile.links)}><div className="profile-stack">
      <div className="profile-fields">{(['label', 'url'] as const).map(key => <FormField key={key} label={t($ => $.profile[key])} error={!link.ignored && importLinkErrors(link)[key] ? t($ => $.profile.formatError) : undefined}>{props => <TextInput {...props} value={link[key]} maxLength={key === 'label' ? 100 : 4096} disabled={disabled || link.ignored} onChange={event => change(draft => ({ ...draft, links: draft.links.map(entry => entry.draftId === link.draftId ? { ...entry, [key]: event.target.value } : entry) }))} />}</FormField>)}</div>
      {!validLink(link) && !link.ignored && <StatusMessage tone="error">{t($ => $.profile.formatError)}</StatusMessage>}
      <Checkbox label={t($ => $.profile.ignore)} checked={link.ignored} disabled={disabled} onChange={event => change(draft => ({ ...draft, links: draft.links.map(entry => entry.draftId === link.draftId ? { ...entry, ignored: event.target.checked } : entry) }))} />
    </div></SectionCard>)}
    {draft.items.filter(item => !item.savedId || draft.facts.some(fact => fact.itemDraftId === item.draftId)).map(item => <SectionCard data-import-id={item.draftId} key={item.draftId} title={item.details.title.trim() || t($ => $.profile.types[item.details.type])}><div className="profile-stack">
      {item.savedId ? <Badge tone="success">{t($ => $.profile.savedEntry)}</Badge> : <>
        <ItemFields review value={item.details} disabled={disabled || item.ignored} onChange={details => change(draft => changeImportItem(draft, item.draftId, details))} />
        {item.error && !item.ignored && <StatusMessage tone="error">{t($ => $.profile.formatError)}</StatusMessage>}
        <Checkbox label={t($ => $.profile.ignore)} checked={item.ignored} disabled={disabled} onChange={event => change(draft => ignoreImportItem(draft, item.draftId, event.target.checked))} />
      </>}
      <div className="profile-facts">{draft.facts.filter(fact => fact.itemDraftId === item.draftId).map(renderFact)}</div>
    </div></SectionCard>)}
    {draft.facts.some(fact => !fact.itemDraftId) && <section className="profile-stack" aria-label={t($ => $.profile.independent)}>
      <h2 className="profile-group-heading">{t($ => $.profile.independent)}</h2>
      {draft.facts.filter(fact => !fact.itemDraftId).map(renderFact)}
    </section>}
  </div>
}
