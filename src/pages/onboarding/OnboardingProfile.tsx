import { useCopyFeedback } from '../../shared/use-copy-feedback'
import { Button, CheckboxInput, Section, Stack, Text, TextArea, TextInput } from '@astryxdesign/core'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import type { Fact, Profile } from '../../domain/candidate/candidate.types'
import type { AIChoice } from '../../shared/ai'
import { useProfileImport } from '../profile/useProfileImport'
import { ImportReview } from '../profile/ImportReview'

export function useOnboardingProfile(model: AIChoice | null) {
  const { data, context } = useServices(), { t } = useTranslation()
  const [profile, setProfile] = useState<Profile | null>(null), [roleFact, setRoleFact] = useState<Fact | null>(null)
  const [name, setName] = useState(''), [role, setRole] = useState(''), [about, setAbout] = useState('')
  const [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [method, setMethod] = useState('manual'), [externalConfirmed, setExternalConfirmed] = useState(false), lock = useRef(false)
  const pdf = useProfileImport(profile, async value => { setProfile(value); setName(value.name); setAbout(value.introduction); setSaved(true) }, model)
  async function load() {
    setLoading(true); setError('')
    try {
      const result = await data.profiles.listProfiles({ limit: 1 })
      if (!result.ok) throw new Error()
      const value = result.value.items[0]
      if (value) {
        setProfile(value); setName(value.name); setAbout(value.introduction); setSaved(true)
        const facts = await data.profiles.listFacts({ profileId: value.id, limit: 100 })
        if (!facts.ok) throw new Error()
        const fact = facts.value.items.find(fact => fact.tags.includes('target-role'))
        setRoleFact(fact ?? null); setRole(fact?.content ?? '')
      }
    } catch { setError(t($ => $.settings.loadFailed)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [data])
  async function save() {
    if (lock.current || loading) return
    if (!name.trim()) { setError(t($ => $.onboarding.nameRequired)); return }
    lock.current = true; setBusy(true); setError('')
    try {
      const details = { name: name.trim(), introduction: about, ...(profile ? { email: profile.email, phone: profile.phone, location: profile.location, links: profile.links } : {}) }
      const result = profile ? await data.profiles.editContact({ id: profile.id, details }) : await data.profiles.createProfile(details)
      if (!result.ok) throw new Error()
      setProfile(result.value); context.setReferences({ profileId: result.value.id })
      if (role.trim()) {
        const details = { kind: 'OTHER' as const, content: role.trim(), tags: ['target-role'] }
        const fact = roleFact ? await data.profiles.editFact({ id: roleFact.id, details }) : await data.profiles.addFact({ profileId: result.value.id, details })
        if (!fact.ok) throw new Error()
        setRoleFact(fact.value)
      } else if (roleFact) {
        const removed = await data.profiles.deleteFact({ id: roleFact.id })
        if (!removed.ok) throw new Error()
        setRoleFact(null)
      }
      setSaved(true)
    } catch { setError(t($ => $.settings.saveFailed)) }
    finally { lock.current = false; setBusy(false) }
  }
  const parsing = ['selecting', 'extracting', 'parsing'].includes(pdf.stage)
  return { name, role, about, profile, setName: (v: string) => { setName(v); setSaved(false) }, setRole: (v: string) => { setRole(v); setSaved(false) },
    setAbout: (v: string) => { setAbout(v); setSaved(false) }, saved, loading, busy: busy || parsing || pdf.saving, error, method, setMethod,
    externalConfirmed, setExternalConfirmed, save, pdf, load, importPdf: () => { void pdf.start(pdf.retryable) } }
}
export function OnboardingProfile({ state: s, model, agent }: { state: ReturnType<typeof useOnboardingProfile>; model: AIChoice | null; agent: boolean }) {
  const { t } = useTranslation(), { pdf } = s
  const [copyFailed, setCopyFailed] = useState(false)
  const method = s.method === 'pdf' && !model || s.method === 'external' && !agent ? 'manual' : s.method
  const modes = ['manual', ...(model ? ['pdf'] : []), ...(agent ? ['external'] : [])] as const
  const clipboard = useCopyFeedback(t($ => $.onboarding.externalPrompt))
  const copyPrompt = async () => {
    setCopyFailed(false)
    try { await navigator.clipboard.writeText(t($ => $.onboarding.externalPrompt)); return true }
    catch { setCopyFailed(true); return false }
  }
  return <div className="onboarding-stack">
    <Stack  className="action-row" direction="horizontal" justify="start" align="center" gap={2} wrap="wrap">{modes.map(id => <Button key={id} aria-pressed={method === id} isDisabled={s.busy} onClick={() => s.setMethod(id)} label={t($ => $.onboarding[id as 'manual' | 'pdf' | 'external'])} />)}</Stack>
    {method === 'manual' && <div className="onboarding-fields">
      <div className="onboarding-two"><TextInput label={t($ => $.onboarding.name)} isDisabled={s.busy || s.loading} ref={input => { if (input) { input.maxLength = 300 } }} value={s.name} onChange={e => s.setName(e)} />
        <TextInput label={t($ => $.onboarding.role)} isDisabled={s.busy || s.loading} ref={input => { if (input) { input.maxLength = 1000 } }} value={s.role} onChange={e => s.setRole(e)} /></div>
      <TextArea label={t($ => $.onboarding.about)} isDisabled={s.busy || s.loading} ref={input => { if (input) input.maxLength = 2000 }} value={s.about} placeholder={t($ => $.onboarding.aboutPlaceholder)} onChange={e => s.setAbout(e)} />
      <Stack  className="action-row" direction="horizontal" justify="start" align="center" gap={2} wrap="wrap"><Button isDisabled={s.busy || s.loading} onClick={() => void s.save()} label={t($ => $.onboarding.saveProfile)} />{s.saved && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.settings.saved)}</Text>}</Stack>
    </div>}
    {method === 'pdf' && <><Section  className="onboarding-drop" variant="muted" padding={3}><Text as="p" type="supporting" role="status">{pdf.fileName || 'PDF'}</Text>
      <Button isDisabled={s.busy} onClick={() => void pdf.upload(false)} label={t($ => $.onboarding.choosePdf)} />
    </Section>
      {pdf.hasFile && !pdf.draft && <Stack  className="action-row" direction="horizontal" justify="start" align="center" gap={2} wrap="wrap"><Button isDisabled={s.busy || pdf.saved} onClick={s.importPdf} label={t($ => $.onboarding.importPdf)} />
        {pdf.saved && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.settings.saved)}</Text>}</Stack>}
      {pdf.draft && <><ImportReview draft={pdf.draft} setDraft={pdf.setDraft} profile={null} disabled={s.busy || pdf.frozen} />
        <Stack  className="action-row" direction="horizontal" justify="start" align="center" gap={2} wrap="wrap"><Button isDisabled={s.busy} onClick={() => void pdf.save()} label={t($ => $.profile.saveImport)} /></Stack></>}
      {pdf.saved && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.settings.saved)}</Text>}
      {s.busy && <Text as="p" type="supporting" role="status">{t($ => $.onboarding.working)}</Text>}
      {pdf.error && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.onboarding.importFailed, { error: pdf.error })}</Text>}
    </>}
    {method === 'external' && <div className="onboarding-fields"><Section className="onboarding-prompt" variant="muted" padding={3}><span>{t($ => $.onboarding.externalPrompt)}</span>
      <Button  label={clipboard.copied ? t($ => $.externalMCP.copied) : t($ => $.onboarding.copy)}
        isDisabled={clipboard.copying || clipboard.copied} aria-busy={clipboard.copying} aria-live="polite" onClick={() => void clipboard.copy(copyPrompt)} /></Section>
      <CheckboxInput label={t($ => $.onboarding.externalConfirmed)} value={s.externalConfirmed} onChange={e => s.setExternalConfirmed(e)} />
    </div>}
    {copyFailed && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalMCP.errors.COPY_FAILED)}</Text>}
    {s.error && <><Text as="p" type="supporting" role="alert" className="error-message">{s.error}</Text>{!s.profile && <Button onClick={() => void s.load()} label={t($ => $.settings.retry)} />}</>}
  </div>
}
