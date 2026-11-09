import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionRow, Button, DetailsList, Dialog, FormField, SectionCard, Select, StatusMessage, TextArea, TextInput } from '../../shared/ui'
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
  const [importEpoch, setImportEpoch] = useState(0)
  const [switchTo, setSwitchTo] = useState<string | null>(null), [action, setAction] = useState<'new' | 'duplicate' | 'freeze' | 'restore' | null>(null), [newTitle, setNewTitle] = useState('')
  const [remove, setRemove] = useState<{ kind: 'item' | 'fact'; id: string } | null>(null)
  const baseline = state.profile ? { title: state.profile.title, name: state.profile.name, email: state.profile.email, phone: state.profile.phone, location: state.profile.location, links: state.profile.links, introduction: state.profile.introduction ?? '' } : emptyContact
  const contactDirty = JSON.stringify(contact) !== JSON.stringify(baseline)
  useEffect(() => { setContact(state.profile ? { title: state.profile.title, name: state.profile.name, email: state.profile.email, phone: state.profile.phone, location: state.profile.location, links: state.profile.links, introduction: state.profile.introduction ?? '' } : emptyContact) }, [state.profile])
  const dirty = contactDirty || Boolean(item || fact) || importDirty
  useProfileGuard(dirty || state.saving)
  async function selectProfile(id: string) {
    if (state.saving) return
    if (dirty) { setSwitchTo(id); return }
    await changeProfile(id)
  }
  async function changeProfile(id: string) {
    setItem(null); setFact(null); setRemove(null); setInvalid(false); setSwitchTo(null); setImportDirty(false); setImportEpoch(value => value + 1)
    await state.perform(() => data.profiles.getProfile({ id }), value => value.id)
  }
  async function profileAction() {
    const profile = state.profile
    const result = action === 'new' ? await state.perform(() => data.profiles.createProfile({ name: newTitle, title: newTitle }))
      : profile && action === 'duplicate' ? await state.perform(() => data.profiles.duplicateProfile({ profileId: profile.id, expectedRevision: profile.revision, title: newTitle }), value => value.id)
      : profile && action === 'freeze' ? await state.perform(() => data.profiles.freezeBaseline({ profileId: profile.id, expectedRevision: profile.revision }))
      : profile && action === 'restore' ? await state.perform(() => data.profiles.restoreBaseline({ profileId: profile.id, expectedRevision: profile.revision })) : null
    if (result) { setAction(null); if (action === 'new' && 'id' in result) await changeProfile(result.id) }
  }
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
      <SectionCard title={t($ => $.profile.profiles)}><div className="profile-stack">
        <FormField label={t($ => $.profile.chooseProfile)}>{props => <Select {...props} value={profileId ?? ''} disabled={state.saving} onChange={event => void selectProfile(event.target.value)}>
          {!profileId && <option value="">{t($ => $.profile.noProfile)}</option>}{state.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.title}</option>)}
        </Select>}</FormField>
        <ActionRow><Button disabled={manualDisabled || dirty} onClick={() => { setNewTitle(''); setAction('new') }}>{t($ => $.profile.newProfile)}</Button>
          <Button disabled={!profileId || manualDisabled || dirty} onClick={() => { setNewTitle(state.profile!.title); setAction('duplicate') }}>{t($ => $.profile.duplicate)}</Button>
          {state.baselineStatus?.status === 'DRAFT' && <Button disabled={manualDisabled || dirty} onClick={() => setAction('freeze')}>{t($ => $.profile.freeze)}</Button>}
          {state.baselineStatus?.status === 'READY' && <Button disabled={manualDisabled || dirty} onClick={() => setAction('restore')}>{t($ => $.profile.restore)}</Button>}
        </ActionRow>
      </div></SectionCard>
      <ProfileImport key={importEpoch} profile={state.profile} onDirty={setImportDirty} onSaved={async profile => { await state.refresh(profile.id) }} disabled={state.saving || contactDirty || Boolean(item || fact)} />
      {!profileId && <StatusMessage>{t($ => $.profile.noProfile)}</StatusMessage>}
      <SectionCard title={t($ => $.profile.basic)}><form className="profile-stack" onSubmit={event => { event.preventDefault(); void saveContact() }}>
        <FormField label={t($ => $.profile.profileTitle)}>{props => <TextInput {...props} name="profileTitle" value={contact.title} maxLength={300} disabled={manualDisabled} onChange={event => setContact({ ...contact, title: event.target.value })} />}</FormField>
        <ContactFields value={contact} required disabled={manualDisabled} onChange={value => { setContact({ ...value, title: contact.title, introduction: contact.introduction }); setInvalid(false) }} />
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
    <Dialog open={switchTo !== null} title={t($ => $.profile.switchTitle)} description={t($ => $.profile.switchDescription)} onClose={() => setSwitchTo(null)}>
      <Button onClick={() => setSwitchTo(null)}>{t($ => $.profile.cancel)}</Button><Button variant="danger" onClick={() => { if (switchTo) void changeProfile(switchTo) }}>{t($ => $.profile.leave)}</Button>
    </Dialog>
    <Dialog open={action !== null} title={action ? t($ => $.profile.actions[action]) : ''} description={action === 'freeze' ? t($ => $.profile.freezeDescription) : action === 'restore' ? t($ => $.profile.restoreDescription) : undefined} onClose={() => { if (!state.saving) setAction(null) }} content={(action === 'new' || action === 'duplicate') ? <FormField label={t($ => $.profile.profileTitle)}>{props => <TextInput {...props} value={newTitle} maxLength={300} disabled={state.saving} onChange={event => setNewTitle(event.target.value)} />}</FormField> : undefined}>
      <Button disabled={state.saving} onClick={() => setAction(null)}>{t($ => $.profile.cancel)}</Button><Button variant={action === 'restore' ? 'danger' : 'primary'} disabled={state.saving || ((action === 'new' || action === 'duplicate') && !newTitle.trim())} onClick={() => void profileAction()}>{t($ => $.profile.confirm)}</Button>
    </Dialog>
    <EditorDialog open={Boolean(item || fact)} disabled={manualDisabled} invalid={invalid} onSave={() => void saveEditor()}
      onClose={() => { if (!state.saving) { setItem(null); setFact(null) } }}>
      {item && <ItemFields value={item.details} fixedType={Boolean(item.id)} disabled={manualDisabled} onChange={details => { setItem({ ...item, details }); setInvalid(false) }} />}
      {fact && <><FormField label={t($ => $.profile.belongsTo)}>{props => <Select {...props} value={fact.profileItemId ?? ''} disabled={manualDisabled} onChange={event => setFact({ ...fact, profileItemId: event.target.value || null })}><option value="">{t($ => $.profile.independent)}</option>{state.items.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select>}</FormField><FactFields value={fact.details} disabled={manualDisabled} onChange={details => { setFact({ ...fact, details }); setInvalid(false) }} /></>}
    </EditorDialog>
    <Dialog open={Boolean(remove)} title={t($ => $.profile.deleteTitle)} description={remove?.kind === 'item' ? t($ => $.profile.deleteItem, { items: deletedIds.size - 1, facts: state.facts.filter(fact => fact.profileItemId && deletedIds.has(fact.profileItemId)).length }) : t($ => $.profile.deleteFact)} onClose={() => { if (!state.saving) setRemove(null) }}><Button disabled={manualDisabled} onClick={() => setRemove(null)}>{t($ => $.profile.cancel)}</Button><Button variant="danger" disabled={manualDisabled} onClick={() => void deleteContent()}>{t($ => $.profile.remove)}</Button></Dialog>
  </div></main>
}
