import { Button, Dialog, DialogHeader, Heading, MetadataList, MetadataListItem, Section, Selector, Stack, Text, TextArea, TextInput } from '@astryxdesign/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
    return <Section key={entry.id} className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.profile.kinds[entry.kind])}</Heading></summary>
      <div className="feature-section-body"><div className="profile-stack">
      <MetadataList>{([{ label: t($ => $.profile.content), value: entry.content },
        ...(entry.tags.length ? [{ label: t($ => $.profile.tags), value: entry.tags.join(', ') }] : [])]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>
      <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
        <Button isDisabled={manualDisabled} onClick={() => beginFact({ kind: entry.kind, content: entry.content, tags: entry.tags }, entry.profileItemId, entry.id)} label={t($ => $.profile.edit)} />
        <Button variant="destructive" isDisabled={manualDisabled} onClick={() => setRemove({ kind: 'fact', id: entry.id })} label={t($ => $.profile.remove)} /></Stack>
    </div></div></details></Section>
  }
  function renderItem(entry: ProfileItem) {
    const { id, profileId: _profileId, parentItemId: _parent, ...details } = entry
    return <ItemCard key={id} value={details} disabled={manualDisabled} onEdit={() => beginItem(details, id)} onRemove={() => setRemove({ kind: 'item', id })}>
      <div className="profile-facts">{state.facts.filter(fact => fact.profileItemId === id).map(renderFact)}
        <Button variant="secondary" isDisabled={manualDisabled} onClick={() => beginFact({ kind: 'ACHIEVEMENT', content: '' }, id)} className="add-record" label={t($ => $.profile.addFact)} />
      </div>
    </ItemCard>
  }
  return <main className="profile-page" aria-label={t($ => $.navigation.pages.profile)}><div className="profile-content">
    {state.error && <Text as="p" type="supporting" role="alert" className="error-message">{state.error === 'loadFailed' ? t($ => $.profile.loadFailed) : t($ => $.profile.errors[state.error as keyof typeof en.profile.errors], { defaultValue: t($ => $.ai.errors[state.error as keyof typeof en.ai.errors], { defaultValue: t($ => $.errors.actionFailed) }) })}</Text>}
    {state.notice && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.profile.saved)}</Text>}
    {state.loading ? <Text as="p" type="supporting" role="status">{t($ => $.profile.loading)}</Text> : state.error === 'loadFailed' ? <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button onClick={() => void state.reload()} label={t($ => $.profile.retry)} /></Stack> : <>
      <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.profile.profiles)}</Heading></summary>
      <div className="feature-section-body"><div className="profile-stack">
        <Selector label={t($ => $.profile.chooseProfile)} htmlName="profileId" value={profileId ?? ''} isDisabled={state.saving} onChange={event => void selectProfile(event)}  options={[...(!profileId  ? [({ value: "", label: t($ => $.profile.noProfile) })] : []), ...(state.profiles.map(profile => ({ value: profile.id, label: profile.title })))]} />
        <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button isDisabled={manualDisabled || dirty} onClick={() => { setNewTitle(''); setAction('new') }} label={t($ => $.profile.newProfile)} />
          <Button isDisabled={!profileId || manualDisabled || dirty} onClick={() => { setNewTitle(state.profile!.title); setAction('duplicate') }} label={t($ => $.profile.duplicate)} />
          {state.baselineStatus?.status === 'DRAFT' && <Button isDisabled={manualDisabled || dirty} onClick={() => setAction('freeze')} label={t($ => $.profile.freeze)} />}
          {state.baselineStatus?.status === 'READY' && <Button isDisabled={manualDisabled || dirty} onClick={() => setAction('restore')} label={t($ => $.profile.restore)} />}
        </Stack>
      </div></div></details></Section>
      <ProfileImport key={importEpoch} profile={state.profile} onDirty={setImportDirty} onSaved={async profile => { await state.refresh(profile.id) }} disabled={state.saving || contactDirty || Boolean(item || fact)} />
      {!profileId && <Text as="p" type="supporting" role="status">{t($ => $.profile.noProfile)}</Text>}
      <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.profile.basic)}</Heading></summary>
      <div className="feature-section-body"><form className="profile-stack" onSubmit={event => { event.preventDefault(); void saveContact() }}>
        <TextInput label={t($ => $.profile.profileTitle)} htmlName="profileTitle" value={contact.title} ref={input => { if (input) { input.maxLength = 300 } }} isDisabled={manualDisabled} onChange={event => setContact({ ...contact, title: event })} />
        <ContactFields value={contact} required disabled={manualDisabled} onChange={value => { setContact({ ...value, title: contact.title, introduction: contact.introduction }); setInvalid(false) }} />
        <TextArea label={t($ => $.profile.introduction)} description={t($ => $.profile.introductionHelp)} value={contact.introduction} ref={input => { if (input) input.maxLength = 2000 }} isDisabled={manualDisabled} onChange={event => { setContact({ ...contact, introduction: event }); setInvalid(false) }} />
        <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button variant="primary" type="submit" isDisabled={manualDisabled || (!contactDirty && Boolean(profileId))} label={state.saving ? t($ => $.profile.saving) : t($ => $.profile.save)} /></Stack>
        {invalid && !item && !fact && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.profile.invalid)}</Text>}
      </form></div></details></Section>
      {itemTypes.map(type => <section key={type} className="profile-stack" aria-label={t($ => $.profile.types[type])}>
        <h2 className="profile-group-heading">{t($ => $.profile.types[type])}</h2>
        {state.items.filter(item => item.type === type).map(renderItem)}
        <Button variant="secondary" isDisabled={!profileId || manualDisabled} onClick={() => beginItem({ type, title: '' })} className="add-record" label={t($ => $.profile.add)} />
      </section>)}
      <section className="profile-stack" aria-label={t($ => $.profile.independent)}>
        <h2 className="profile-group-heading">{t($ => $.profile.independent)}</h2>
        {state.facts.filter(fact => !fact.profileItemId).map(renderFact)}
        <Button variant="secondary" isDisabled={!profileId || manualDisabled} onClick={() => beginFact({ kind: 'SKILL', content: '' }, null)} className="add-record" label={t($ => $.profile.addFact)} />
      </section>
    </>}
    <Dialog  isOpen={switchTo !== null} onOpenChange={() => setSwitchTo(null)} aria-label={t($ => $.profile.switchTitle)} width={448} purpose="form">
      <DialogHeader title={t($ => $.profile.switchTitle)} subtitle={t($ => $.profile.switchDescription)} />
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
      <Button onClick={() => setSwitchTo(null)} label={t($ => $.profile.cancel)} /><Button variant="destructive" onClick={() => { if (switchTo) void changeProfile(switchTo) }} label={t($ => $.profile.leave)} />
    </Stack>
    </Dialog>
    <Dialog  isOpen={action !== null} onOpenChange={() => { if (!state.saving) setAction(null) }} aria-label={action ? t($ => $.profile.actions[action]) : ''} width={448} purpose="form">
      <DialogHeader title={action ? t($ => $.profile.actions[action]) : ''} subtitle={action === 'freeze' ? t($ => $.profile.freezeDescription) : action === 'restore' ? t($ => $.profile.restoreDescription) : undefined} />
      <div className="dialog-content">{(action === 'new' || action === 'duplicate') ? <TextInput label={t($ => $.profile.profileTitle)} value={newTitle} ref={input => { if (input) { input.maxLength = 300 } }} isDisabled={state.saving} onChange={event => setNewTitle(event)} /> : undefined}</div>
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
      <Button isDisabled={state.saving} onClick={() => setAction(null)} label={t($ => $.profile.cancel)} /><Button variant={action === 'restore' ? 'destructive' : 'primary'} isDisabled={state.saving || ((action === 'new' || action === 'duplicate') && !newTitle.trim())} onClick={() => void profileAction()} label={t($ => $.profile.confirm)} />
    </Stack>
    </Dialog>
    <EditorDialog open={Boolean(item || fact)} disabled={manualDisabled} invalid={invalid} onSave={() => void saveEditor()}
      onClose={() => { if (!state.saving) { setItem(null); setFact(null) } }}>
      {item && <ItemFields value={item.details} fixedType={Boolean(item.id)} disabled={manualDisabled} onChange={details => { setItem({ ...item, details }); setInvalid(false) }} />}
      {fact && <><Selector label={t($ => $.profile.belongsTo)} value={fact.profileItemId ?? ''} isDisabled={manualDisabled} onChange={event => setFact({ ...fact, profileItemId: event || null })}  options={[({ value: "", label: t($ => $.profile.independent) }), ...(state.items.map(item => ({ value: item.id, label: item.title })))]} /><FactFields value={fact.details} disabled={manualDisabled} onChange={details => { setFact({ ...fact, details }); setInvalid(false) }} /></>}
    </EditorDialog>
    <Dialog  isOpen={Boolean(remove)} onOpenChange={() => { if (!state.saving) setRemove(null) }} aria-label={t($ => $.profile.deleteTitle)} width={448} purpose="form">
      <DialogHeader title={t($ => $.profile.deleteTitle)} subtitle={remove?.kind === 'item' ? t($ => $.profile.deleteItem, { items: deletedIds.size - 1, facts: state.facts.filter(fact => fact.profileItemId && deletedIds.has(fact.profileItemId)).length }) : t($ => $.profile.deleteFact)} />
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row"><Button isDisabled={manualDisabled} onClick={() => setRemove(null)} label={t($ => $.profile.cancel)} /><Button variant="destructive" isDisabled={manualDisabled} onClick={() => void deleteContent()} label={t($ => $.profile.remove)} /></Stack>
    </Dialog>
  </div></main>
}
