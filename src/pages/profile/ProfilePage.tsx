import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionRow, Button, DetailsList, Dialog, FormField, SectionCard, Select, StatusMessage, TextArea } from '../../shared/ui'
import { useServices } from '../../app/providers'
import type { ProfileDetails, Fact, FactInput, ItemInput, ProfileItem } from '../../domain/candidate/candidate.types'
import { itemTypes } from '../../domain/candidate/candidate.types'
import { profileDetails as parseContact, factDetails, itemDetails, validateItemDates } from '../../domain/candidate/candidate.validation'
import { ContactFields, emptyContact, FactFields, ItemFields } from '../../app/profile-editor/ProfileFields'
import { useProfile } from './useProfile'
import { useProfileGuard } from './useProfileGuard'
import { ProfileImport } from './ProfileImport'
import { EditorDialog, ItemCard } from '../../app/profile-editor/EditorComponents'
import './profile.css'
import type { en } from '../../shared/i18n/locales/en'

export function ProfilePage() {
  const { t } = useTranslation(), { data } = useServices(), state = useProfile()
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
        ...(entry.tags.length ? [{ label: t($ => $.profile.tags), value: entry.tags.join(', ') }] : [])]} />
      <ActionRow>
        <Button disabled={manualDisabled} onClick={() => beginFact({ kind: entry.kind, content: entry.content, tags: entry.tags }, entry.profileItemId, entry.id)}>{t($ => $.profile.edit)}</Button>
        <Button variant="danger" disabled={manualDisabled} onClick={() => setRemove({ kind: 'fact', id: entry.id })}>{t($ => $.profile.remove)}</Button></ActionRow>
    </div></SectionCard>
  }
  function renderItem(entry: ProfileItem) {
    const { id, profileId: _profileId, parentItemId: _parent, ...details } = entry
    return <ItemCard key={id} value={details} disabled={manualDisabled} onEdit={() => beginItem(details, id)} onRemove={() => setRemove({ kind: 'item', id })}>
      <div className="profile-facts">{state.facts.filter(fact => fact.profileItemId === id).map(renderFact)}
        <Button variant="add-card" disabled={manualDisabled} onClick={() => beginFact({ kind: 'ACHIEVEMENT', content: '' }, id)}>{t($ => $.profile.addFact)}</Button>
      </div>
    </ItemCard>
  }
  return <main className="profile-page" aria-label={t($ => $.navigation.pages.profile)}><div className="profile-content">
    {state.error && <StatusMessage tone="error">{state.error === 'loadFailed' ? t($ => $.profile.loadFailed) : t($ => $.profile.errors[state.error as keyof typeof en.profile.errors], { defaultValue: t($ => $.ai.errors[state.error as keyof typeof en.ai.errors], { defaultValue: t($ => $.errors.actionFailed) }) })}</StatusMessage>}
    {state.notice && <StatusMessage tone="success">{t($ => $.profile.saved)}</StatusMessage>}
    {state.loading ? <StatusMessage>{t($ => $.profile.loading)}</StatusMessage> : state.error === 'loadFailed' ? <ActionRow><Button onClick={() => void state.reload()}>{t($ => $.profile.retry)}</Button></ActionRow> : <>
      <ProfileImport profile={state.profile} onDirty={setImportDirty} onSaved={async profile => { await state.refresh(profile.id) }} disabled={state.saving || contactDirty || Boolean(item || fact)} />
      {!profileId && <StatusMessage>{t($ => $.profile.noProfile)}</StatusMessage>}
      <SectionCard title={t($ => $.profile.basic)}><form className="profile-stack" onSubmit={event => { event.preventDefault(); void saveContact() }}>
        <ContactFields value={contact} required disabled={manualDisabled} onChange={value => { setContact({ ...value, introduction: contact.introduction }); setInvalid(false) }} />
        <FormField label={t($ => $.profile.introduction)} help={t($ => $.profile.introductionHelp)}>{props => <TextArea {...props} value={contact.introduction} maxLength={2000} disabled={manualDisabled} onChange={event => { setContact({ ...contact, introduction: event.target.value }); setInvalid(false) }} />}</FormField>
        <ActionRow><Button variant="primary" type="submit" disabled={manualDisabled || (!contactDirty && Boolean(profileId))}>{state.saving ? t($ => $.profile.saving) : t($ => $.profile.save)}</Button></ActionRow>
        {invalid && !item && !fact && <StatusMessage tone="error">{t($ => $.profile.invalid)}</StatusMessage>}
      </form></SectionCard>
      {itemTypes.map(type => <section key={type} className="profile-stack" aria-label={t($ => $.profile.types[type])}>
        <h2 className="profile-group-heading">{t($ => $.profile.types[type])}</h2>
        {state.items.filter(item => item.type === type).map(renderItem)}
        <Button variant="add-card" disabled={!profileId || manualDisabled} onClick={() => beginItem({ type, title: '' })}>{t($ => $.profile.add)}</Button>
      </section>)}
      <section className="profile-stack" aria-label={t($ => $.profile.independent)}>
        <h2 className="profile-group-heading">{t($ => $.profile.independent)}</h2>
        {state.facts.filter(fact => !fact.profileItemId).map(renderFact)}
        <Button variant="add-card" disabled={!profileId || manualDisabled} onClick={() => beginFact({ kind: 'SKILL', content: '' }, null)}>{t($ => $.profile.addFact)}</Button>
      </section>
    </>}
    <EditorDialog open={Boolean(item || fact)} disabled={manualDisabled} invalid={invalid} onSave={() => void saveEditor()}
      onClose={() => { if (!state.saving) { setItem(null); setFact(null) } }}>
      {item && <ItemFields value={item.details} fixedType={Boolean(item.id)} disabled={manualDisabled} onChange={details => { setItem({ ...item, details }); setInvalid(false) }} />}
      {fact && <><FormField label={t($ => $.profile.belongsTo)}>{props => <Select {...props} value={fact.profileItemId ?? ''} disabled={manualDisabled} onChange={event => setFact({ ...fact, profileItemId: event.target.value || null })}><option value="">{t($ => $.profile.independent)}</option>{state.items.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select>}</FormField><FactFields value={fact.details} disabled={manualDisabled} onChange={details => { setFact({ ...fact, details }); setInvalid(false) }} /></>}
    </EditorDialog>
    <Dialog open={Boolean(remove)} title={t($ => $.profile.deleteTitle)} description={remove?.kind === 'item' ? t($ => $.profile.deleteItem, { items: deletedIds.size - 1, facts: state.facts.filter(fact => fact.profileItemId && deletedIds.has(fact.profileItemId)).length }) : t($ => $.profile.deleteFact)} onClose={() => { if (!state.saving) setRemove(null) }}><Button disabled={manualDisabled} onClick={() => setRemove(null)}>{t($ => $.profile.cancel)}</Button><Button variant="danger" disabled={manualDisabled} onClick={() => void deleteContent()}>{t($ => $.profile.remove)}</Button></Dialog>
  </div></main>
}
