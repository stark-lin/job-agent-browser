import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, DetailsList, Dialog, FormField, PageHeading, SectionCard, Select, StatusMessage, TextArea, TextInput } from '../../shared/ui'
import { useServices } from '../../app/providers'
import { useNavigation } from '../../app/navigation/navigate'
import type { ProfileDetails, Fact, FactInput, ItemInput, ProfileItem } from '../../domain/candidate/candidate.types'
import { itemTypes } from '../../domain/candidate/candidate.types'
import { profileDetails as parseContact, factDetails, itemDetails, validateItemDates } from '../../domain/candidate/candidate.validation'
import { contactKeys, emptyContact, FactFields, ItemFields } from './ProfileFields'
import { useProfile } from './useProfile'
import { useProfileGuard } from './useProfileGuard'
import { ProfileImport } from './ProfileImport'
import './profile.css'
import type { en } from '../../shared/i18n/locales/en'

export function ProfilePage() {
  const { t } = useTranslation(), { data } = useServices(), { openPage } = useNavigation(), state = useProfile()
  const [contact, setContact] = useState<ProfileDetails>(emptyContact), [invalid, setInvalid] = useState(false), [importDirty, setImportDirty] = useState(false)
  const [item, setItem] = useState<{ id: string | null; details: ItemInput } | null>(null)
  const [fact, setFact] = useState<{ id: string | null; profileItemId: string | null; details: FactInput } | null>(null)
  const [remove, setRemove] = useState<{ kind: 'item' | 'fact'; id: string } | null>(null)
  const baseline = state.profile ? { name: state.profile.name, email: state.profile.email, phone: state.profile.phone, location: state.profile.location, links: state.profile.links, introduction: state.profile.introduction ?? '' } : emptyContact
  const contactDirty = JSON.stringify(contact) !== JSON.stringify(baseline)
  useEffect(() => { setContact(state.profile ? { name: state.profile.name, email: state.profile.email, phone: state.profile.phone, location: state.profile.location, links: state.profile.links, introduction: state.profile.introduction ?? '' } : emptyContact) }, [state.profile])
  useProfileGuard(contactDirty || Boolean(item || fact) || importDirty || state.saving)
  const profileId = state.profile?.id
  const manualDisabled = state.saving || importDirty
  const beginItem = (details: ItemInput, id: string | null = null) => { setItem({ id, details }); setInvalid(false) }
  const beginFact = (details: FactInput, profileItemId: string | null, id: string | null = null) => { setFact({ id, details, profileItemId }); setInvalid(false) }
  async function saveContact() {
    try { parseContact(contact) } catch { setInvalid(true); return }
    setInvalid(false)
    await state.perform(() => profileId ? data.profiles.editContact({ id: profileId, details: contact }) : data.profiles.createProfile(contact), value => value.id)
  }
  async function saveEditor() {
    if (!profileId) return
    try {
      if (item) validateItemDates(itemDetails(item.details))
      if (fact) factDetails(fact.details)
    } catch { setInvalid(true); return }
    const result = item ? await state.perform(() => item.id ? data.profiles.editItem({ id: item.id, details: item.details }) : data.profiles.addItem({ profileId, details: item.details }))
      : fact ? await state.perform(() => fact.id ? data.profiles.editFact({ id: fact.id, profileItemId: fact.profileItemId, details: fact.details }) : data.profiles.addFact({ profileId, profileItemId: fact.profileItemId, details: fact.details })) : null
    if (result) { setItem(null); setFact(null); setInvalid(false) }
  }
  const deletedIds = new Set(remove?.kind === 'item' ? [remove.id] : [])
  for (let count = -1; count !== deletedIds.size;) {
    count = deletedIds.size
    for (const entry of state.items) if (entry.parentItemId && deletedIds.has(entry.parentItemId)) deletedIds.add(entry.id)
  }
  async function deleteContent() {
    if (!remove) return
    const result = await state.perform(() => remove.kind === 'item' ? data.profiles.deleteItem({ id: remove.id }) : data.profiles.deleteFact({ id: remove.id }))
    if (result) setRemove(null)
  }
  function renderFact(entry: Fact) {
    return <SectionCard key={entry.id} title={t($ => $.profile.kinds[entry.kind])}><div className="profile-stack">
      <DetailsList items={[{ label: t($ => $.profile.content), value: entry.content },
        ...(entry.tags.length ? [{ label: t($ => $.profile.tags), value: entry.tags.join(', ') }] : []),
        ...(entry.evidence ? [{ label: t($ => $.profile.evidence), value: entry.evidence }] : [])]} />
      <div className="profile-actions">
        <Button disabled={manualDisabled} onClick={() => beginFact({ kind: entry.kind, content: entry.content, tags: entry.tags, evidence: entry.evidence }, entry.profileItemId, entry.id)}>{t($ => $.profile.edit)}</Button>
        <Button variant="danger" disabled={manualDisabled} onClick={() => setRemove({ kind: 'fact', id: entry.id })}>{t($ => $.profile.remove)}</Button></div>
    </div></SectionCard>
  }
  function renderItem(entry: ProfileItem) {
    const { id, profileId: _profileId, parentItemId: _parent, ...details } = entry
    return <SectionCard key={id} title={entry.title} description={[entry.organization, entry.role].filter(Boolean).join(' · ')}><div className="profile-stack">
      <DetailsList items={[
        { label: t($ => $.profile.startDate), value: entry.metadata.startDateText || entry.startDate || '—' },
        { label: t($ => $.profile.endDate), value: entry.metadata.isCurrent ? t($ => $.profile.current) : entry.metadata.endDateText || entry.endDate || '—' },
        ...(['location', 'summary'] as const).filter(key => entry[key]).map(key => ({ label: t($ => $.profile[key]), value: entry[key] })),
        ...(['degree', 'major', 'gpa', 'employmentType', 'url'] as const).filter(key => entry.metadata[key]).map(key => ({ label: t($ => $.profile[key]), value: entry.metadata[key] })),
        ...(entry.metadata.technologies?.length ? [{ label: t($ => $.profile.technologies), value: entry.metadata.technologies.join(', ') }] : [])
      ]} />
      <div className="profile-actions"><Button disabled={manualDisabled} onClick={() => beginItem(details, id)}>{t($ => $.profile.edit)}</Button><Button variant="danger" disabled={manualDisabled} onClick={() => setRemove({ kind: 'item', id })}>{t($ => $.profile.remove)}</Button><Button disabled={manualDisabled} onClick={() => beginFact({ kind: 'ACHIEVEMENT', content: '' }, id)}>{t($ => $.profile.addFact)}</Button></div>
      <div className="profile-facts">{state.facts.filter(fact => fact.profileItemId === id).map(renderFact)}</div>
    </div></SectionCard>
  }
  return <main className="profile-page"><div className="profile-content">
    <div className="page-actions"><Button variant="ghost" onClick={() => void openPage('home')}>{t($ => $.navigation.goHome)}</Button></div>
    <PageHeading title={t($ => $.navigation.pages.profile)} description={t($ => $.profile.subtitle)} />
    {state.error && <StatusMessage tone="error">{state.error === 'loadFailed' ? t($ => $.profile.loadFailed) : t($ => $.profile.errors[state.error as keyof typeof en.profile.errors], { defaultValue: t($ => $.ai.errors[state.error as keyof typeof en.ai.errors], { defaultValue: t($ => $.errors.actionFailed) }) })}</StatusMessage>}
    {state.notice && <StatusMessage tone="success">{t($ => $.profile.saved)}</StatusMessage>}
    {state.loading ? <StatusMessage>{t($ => $.profile.loading)}</StatusMessage> : state.error === 'loadFailed' ? <Button onClick={() => void state.reload()}>{t($ => $.profile.retry)}</Button> : <>
      <ProfileImport profile={state.profile} onDirty={setImportDirty} onSaved={async profile => { await state.refresh(profile.id) }} disabled={state.saving || contactDirty || Boolean(item || fact)} />
      {!profileId && <StatusMessage>{t($ => $.profile.noProfile)}</StatusMessage>}
      <SectionCard title={t($ => $.profile.basic)}><form className="profile-stack" onSubmit={event => { event.preventDefault(); void saveContact() }}>
        <div className="profile-fields">{contactKeys.map(key => <FormField key={key} label={t($ => $.profile[key])}>{props => <TextInput {...props} value={contact[key]} required={key === 'name'} maxLength={key === 'name' ? 300 : key === 'email' ? 320 : key === 'phone' ? 100 : 1000} disabled={manualDisabled} onChange={event => { setContact({ ...contact, [key]: event.target.value }); setInvalid(false) }} />}</FormField>)}</div>
        <FormField label={t($ => $.profile.introduction)} help={t($ => $.profile.introductionHelp)}>{props => <TextArea {...props} value={contact.introduction} maxLength={2000} disabled={manualDisabled} onChange={event => { setContact({ ...contact, introduction: event.target.value }); setInvalid(false) }} />}</FormField>
        {contact.links.map((link, index) => <div className="profile-stack" key={index}><div className="profile-fields">{(['label', 'url'] as const).map(key => <FormField key={key} label={t($ => $.profile[key])}>{props => <TextInput {...props} value={link[key]} required maxLength={key === 'label' ? 100 : 4096} disabled={manualDisabled} onChange={event => setContact({ ...contact, links: contact.links.map((value, i) => i === index ? { ...value, [key]: event.target.value } : value) })} />}</FormField>)}</div><div><Button disabled={manualDisabled} onClick={() => setContact({ ...contact, links: contact.links.filter((_, i) => i !== index) })}>{t($ => $.profile.remove)}</Button></div></div>)}
        <div className="profile-actions"><Button disabled={manualDisabled || contact.links.length >= 20} onClick={() => setContact({ ...contact, links: [...contact.links, { label: '', url: '' }] })}>{t($ => $.profile.add)} {t($ => $.profile.links)}</Button><Button variant="primary" type="submit" disabled={manualDisabled || (!contactDirty && Boolean(profileId))}>{state.saving ? t($ => $.profile.saving) : t($ => $.profile.save)}</Button></div>
        {invalid && !item && !fact && <StatusMessage tone="error">{t($ => $.profile.invalid)}</StatusMessage>}
      </form></SectionCard>
      {itemTypes.map(type => <SectionCard key={type} title={t($ => $.profile.types[type])}><div className="profile-stack">
        <div><Button disabled={!profileId || manualDisabled} onClick={() => beginItem({ type, title: '' })}>{t($ => $.profile.add)}</Button></div>
        {!state.items.some(item => item.type === type) && <StatusMessage>{t($ => $.profile.empty)}</StatusMessage>}
        {state.items.filter(item => item.type === type).map(renderItem)}
      </div></SectionCard>)}
      <SectionCard title={t($ => $.profile.independent)}><div className="profile-stack"><div><Button disabled={!profileId || manualDisabled} onClick={() => beginFact({ kind: 'SKILL', content: '' }, null)}>{t($ => $.profile.addFact)}</Button></div>{state.facts.filter(fact => !fact.profileItemId).map(renderFact)}</div></SectionCard>
    </>}
    <Dialog open={Boolean(item || fact)} title={t($ => $.profile.edit)} description={t($ => $.profile.subtitle)} onClose={() => { if (!state.saving) { setItem(null); setFact(null) } }} content={<form id="profile-editor" className="profile-stack" onSubmit={event => { event.preventDefault(); void saveEditor() }}>
      {item && <ItemFields value={item.details} fixedType={Boolean(item.id)} disabled={manualDisabled} onChange={details => { setItem({ ...item, details }); setInvalid(false) }} />}
      {fact && <><FormField label={t($ => $.profile.belongsTo)}>{props => <Select {...props} value={fact.profileItemId ?? ''} disabled={manualDisabled} onChange={event => setFact({ ...fact, profileItemId: event.target.value || null })}><option value="">{t($ => $.profile.independent)}</option>{state.items.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select>}</FormField><FactFields value={fact.details} disabled={manualDisabled} onChange={details => { setFact({ ...fact, details }); setInvalid(false) }} /></>}
      {invalid && <StatusMessage tone="error">{t($ => $.profile.invalid)}</StatusMessage>}
    </form>}><Button disabled={manualDisabled} onClick={() => { setItem(null); setFact(null) }}>{t($ => $.profile.cancel)}</Button><Button form="profile-editor" type="submit" variant="primary" disabled={manualDisabled}>{t($ => $.profile.save)}</Button></Dialog>
    <Dialog open={Boolean(remove)} title={t($ => $.profile.deleteTitle)} description={remove?.kind === 'item' ? t($ => $.profile.deleteItem, { items: deletedIds.size - 1, facts: state.facts.filter(fact => fact.profileItemId && deletedIds.has(fact.profileItemId)).length }) : t($ => $.profile.deleteFact)} onClose={() => { if (!state.saving) setRemove(null) }}><Button disabled={manualDisabled} onClick={() => setRemove(null)}>{t($ => $.profile.cancel)}</Button><Button variant="danger" disabled={manualDisabled} onClick={() => void deleteContent()}>{t($ => $.profile.remove)}</Button></Dialog>
  </div></main>
}
