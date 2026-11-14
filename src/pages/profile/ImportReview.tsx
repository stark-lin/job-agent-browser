import { Badge, Button, CheckboxInput, Heading, MetadataList, MetadataListItem, Section, Selector, Stack, Text, TextArea, TextInput, type SelectorSection } from '@astryxdesign/core'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
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
    return <Section className="feature-section" padding={0}><details data-import-id={fact.draftId} key={fact.draftId} open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.profile.kinds[fact.details.kind])}</Heading></summary>
      <div className="feature-section-body"><div className="profile-stack">
      <Selector label={t($ => $.profile.belongsTo)} value={fact.itemDraftId ?? ''} isDisabled={disabled || fact.ignored} onChange={event => change(draft => changeImportFact(draft, fact.draftId, { itemDraftId: event || null }))}  options={[({ value: "", label: t($ => $.profile.independent) }), ...(draft.items.filter(item => !item.ignored).map(item => ({ value: item.draftId, label: item.details.title || t($ => $.profile.types[item.details.type]) })))]} />
      <FactFields review value={fact.details} disabled={disabled || fact.ignored || ignoredParent} onChange={details => change(draft => changeImportFact(draft, fact.draftId, { details }))} />
      {fact.error && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.profile.formatError)}</Text>}
      {!ready && !fact.ignored && <Text as="p" type="supporting" role="status">{t($ => $.profile.parentRequired)}</Text>}
      <CheckboxInput label={t($ => $.profile.ignore)} value={fact.ignored} isDisabled={disabled || ignoredParent} onChange={event => change(draft => ({ ...draft, facts: draft.facts.map(entry => entry.draftId === fact.draftId ? { ...entry, ignored: event } : entry) }))} />
    </div></div></details></Section>
  }
  return <div className="profile-stack">
    <Text as="p" type="supporting" role="status">{t($ => $.profile.reviewHelp)}</Text>
    {draft.unmapped?.map(row => {
      const discard = (value: ImportDraft) => ({ ...value, unmapped: value.unmapped?.filter(entry => entry.draftId !== row.draftId) })
      return <Section key={row.draftId} className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.profile.unmapped)}</Heading></summary>
      <div className="feature-section-body"><div className="profile-stack">
        <MetadataList>{([{ label: t($ => $.profile.sourcePosition, { ...row.source }), value: row.text }]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>
        <Selector label={t($ => $.profile.mapField)} value="" isDisabled={disabled} onChange={event => {
          const target = event
          const key = basicKeys.find(key => key === target)
          if (key) {
            change(value => ({ ...discard(value), contact: { ...value.contact, [key]: { value: row.text, ignored: false } } }))
            return
          }
          const [id, field] = target.split('/')
          const item = mappedItems.find(item => item.draftId === id), itemKey = itemKeys.find(key => key === field)
          if (item && itemKey) change(value => changeImportItem(discard(value), id, { ...item.details, [itemKey]: row.text }))
        }}  options={[({ value: "", label: t($ => $.profile.mapField) }), ...(basicKeys.filter(key => !draft.contact[key].saved && !draft.contact[key].value.trim()).map(key =>
            ({ value: key, label: t($ => $.profile[key]) }))), ...(mappedItems.map<SelectorSection>(item => ({ type: 'section', title: item.details.title || t($ => $.profile.types[item.details.type]), options: itemKeys.filter(key => !item.details[key]?.trim()).map(key => ({ value: `${item.draftId}/${key}`, label: t($ => $.profile[key]) })) })))]} />
        <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button isDisabled={disabled} onClick={() => change(value => ({ ...discard(value), facts: [...value.facts, {
          draftId: row.draftId, source: row.source, details: { kind: 'OTHER', content: row.text }, ignored: false, error: false, itemDraftId: null, profileItemId: null
        }] }))} label={t($ => $.profile.addFact)} />
        <Button isDisabled={disabled} onClick={() => change(discard)} label={t($ => $.profile.ignore)} /></Stack>
      </div></div></details></Section>
    })}

    <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.profile.basic)}</Heading></summary>
      <div className="feature-section-body"><div className="profile-stack">{basicKeys.filter(key => !draft.contact[key].saved).map(key => {
      const field = draft.contact[key], valid = validContact(key, field.value)
      const control = {
        label: t($ => $.profile[key]),
        description: t($ => $.profile.existing, { value: profile?.[key] || t($ => $.profile.emptyValue) }),
        status: !valid && !field.ignored ? { type: 'error' as const, message: t($ => $.profile.formatError) } : undefined,
        value: field.value,
        isDisabled: disabled || field.ignored,
        onChange: (value: string) => change(draft => ({ ...draft, contact: { ...draft.contact, [key]: { ...field, value } } }))
      }
      return <div className="profile-stack" key={key} data-import-id={`contact-${key}`}>
        {key === 'introduction'
          ? <TextArea {...control} ref={input => { if (input) input.maxLength = 2000 }} />
          : <TextInput {...control} ref={input => { if (input) { input.maxLength = key === 'name' ? 300 : key === 'email' ? 320 : key === 'phone' ? 100 : 1000 } }} />}
        <div><CheckboxInput label={t($ => $.profile.ignore)} value={field.ignored} isDisabled={disabled} onChange={event => change(draft => ({ ...draft, contact: { ...draft.contact, [key]: { ...field, ignored: event } } }))} /></div>
      </div>
    })}</div></div></details></Section>
    {draft.links.map(link => <Section className="feature-section" padding={0}><details data-import-id={link.draftId} key={link.draftId} open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.profile.links)}</Heading></summary>
      <div className="feature-section-body"><div className="profile-stack">
      <div className="profile-fields">{(['label', 'url'] as const).map(key => <TextInput label={t($ => $.profile[key])} key={key} status={(!link.ignored && importLinkErrors(link)[key] ? t($ => $.profile.formatError) : undefined) ? { type: 'error', message: !link.ignored && importLinkErrors(link)[key] ? t($ => $.profile.formatError) : undefined } : undefined} value={link[key]} ref={input => { if (input) { input.maxLength = key === 'label' ? 100 : 4096 } }} isDisabled={disabled || link.ignored} onChange={event => change(draft => ({ ...draft, links: draft.links.map(entry => entry.draftId === link.draftId ? { ...entry, [key]: event } : entry) }))} />)}</div>
      {!validLink(link) && !link.ignored && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.profile.formatError)}</Text>}
      <CheckboxInput label={t($ => $.profile.ignore)} value={link.ignored} isDisabled={disabled} onChange={event => change(draft => ({ ...draft, links: draft.links.map(entry => entry.draftId === link.draftId ? { ...entry, ignored: event } : entry) }))} />
    </div></div></details></Section>)}
    {draft.items.filter(item => !item.savedId || draft.facts.some(fact => fact.itemDraftId === item.draftId)).map(item => <Section className="feature-section" padding={0}><details data-import-id={item.draftId} key={item.draftId} open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{item.details.title.trim() || t($ => $.profile.types[item.details.type])}</Heading></summary>
      <div className="feature-section-body"><div className="profile-stack">
      {item.savedId ? <Badge  variant={"success"} label={t($ => $.profile.savedEntry)} /> : <>
        <ItemFields review value={item.details} disabled={disabled || item.ignored} onChange={details => change(draft => changeImportItem(draft, item.draftId, details))} />
        {item.error && !item.ignored && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.profile.formatError)}</Text>}
        <CheckboxInput label={t($ => $.profile.ignore)} value={item.ignored} isDisabled={disabled} onChange={event => change(draft => ignoreImportItem(draft, item.draftId, event))} />
      </>}
      <div className="profile-facts">{draft.facts.filter(fact => fact.itemDraftId === item.draftId).map(renderFact)}</div>
    </div></div></details></Section>)}
    {draft.facts.some(fact => !fact.itemDraftId) && <section className="profile-stack" aria-label={t($ => $.profile.independent)}>
      <h2 className="profile-group-heading">{t($ => $.profile.independent)}</h2>
      {draft.facts.filter(fact => !fact.itemDraftId).map(renderFact)}
    </section>}
  </div>
}
