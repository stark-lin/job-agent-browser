import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import type { Fact, Profile } from '../../domain/candidate/candidate.types'
import type { AIChoice } from '../../shared/ai'
import { ActionRow, Button, Checkbox, CopyButton, FormField, QuietPanel, StatusMessage, TextArea, TextInput } from '../../shared/ui'
import { useProfileImport } from '../profile/useProfileImport'

export function useOnboardingProfile(model: AIChoice | null) {
  const { data, context } = useServices(), { t } = useTranslation()
  const [profile, setProfile] = useState<Profile | null>(null), [roleFact, setRoleFact] = useState<Fact | null>(null)
  const [name, setName] = useState(''), [role, setRole] = useState(''), [about, setAbout] = useState('')
  const [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [method, setMethod] = useState('manual'), [externalConfirmed, setExternalConfirmed] = useState(false), lock = useRef(false)
  const [importing, setImporting] = useState(false), applyingImport = useRef(false)
  const pdf = useProfileImport(profile, async value => { setProfile(value); setName(value.name); setAbout(value.introduction); setSaved(true) }, model)
  useEffect(() => {
    if (pdf.stage === 'failed') setImporting(false)
    if (!importing || pdf.stage !== 'ready' || !pdf.draft || applyingImport.current) return
    applyingImport.current = true
    void pdf.save().finally(() => { applyingImport.current = false; setImporting(false) })
  }, [importing, pdf.stage, pdf.draft])
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
    setAbout: (v: string) => { setAbout(v); setSaved(false) }, saved, loading, busy: busy || parsing || pdf.saving || importing, error, method, setMethod,
    externalConfirmed, setExternalConfirmed, save, pdf, load, importPdf: () => { setImporting(true); if (!pdf.draft) void pdf.start(pdf.retryable) } }
}
export function OnboardingProfile({ state: s, model, agent }: { state: ReturnType<typeof useOnboardingProfile>; model: AIChoice | null; agent: boolean }) {
  const { t } = useTranslation(), { pdf } = s
  const [copyFailed, setCopyFailed] = useState(false)
  const method = s.method === 'pdf' && !model || s.method === 'external' && !agent ? 'manual' : s.method
  const modes = ['manual', ...(model ? ['pdf'] : []), ...(agent ? ['external'] : [])] as const
  const copyPrompt = async () => {
    setCopyFailed(false)
    try { await navigator.clipboard.writeText(t($ => $.onboarding.externalPrompt)); return true }
    catch { setCopyFailed(true); return false }
  }
  return <div className="onboarding-stack">
    <ActionRow align="start">{modes.map(id => <Button key={id} aria-pressed={method === id} disabled={s.busy} onClick={() => s.setMethod(id)}>{t($ => $.onboarding[id as 'manual' | 'pdf' | 'external'])}</Button>)}</ActionRow>
    {method === 'manual' && <div className="onboarding-fields">
      <div className="onboarding-two"><FormField label={t($ => $.onboarding.name)}>{props => <TextInput {...props} disabled={s.busy || s.loading} maxLength={300} value={s.name} onChange={e => s.setName(e.target.value)} />}</FormField>
        <FormField label={t($ => $.onboarding.role)}>{props => <TextInput {...props} disabled={s.busy || s.loading} maxLength={1000} value={s.role} onChange={e => s.setRole(e.target.value)} />}</FormField></div>
      <FormField label={t($ => $.onboarding.about)}>{props => <TextArea {...props} disabled={s.busy || s.loading} maxLength={2000} value={s.about} placeholder={t($ => $.onboarding.aboutPlaceholder)} onChange={e => s.setAbout(e.target.value)} />}</FormField>
      <ActionRow align="start"><Button disabled={s.busy || s.loading} onClick={() => void s.save()}>{t($ => $.onboarding.saveProfile)}</Button>{s.saved && <StatusMessage tone="success">{t($ => $.settings.saved)}</StatusMessage>}</ActionRow>
    </div>}
    {method === 'pdf' && <><QuietPanel variant="dashed" className="onboarding-drop"><StatusMessage>{pdf.fileName || 'PDF'}</StatusMessage>
      <Button disabled={s.busy} onClick={() => void pdf.upload(false)}>{t($ => $.onboarding.choosePdf)}</Button>
    </QuietPanel>
      {pdf.hasFile && <ActionRow align="start"><Button disabled={s.busy || pdf.saved} onClick={s.importPdf}>{t($ => $.onboarding.importPdf)}</Button>
        {pdf.saved && <StatusMessage tone="success">{t($ => $.settings.saved)}</StatusMessage>}</ActionRow>}
      {s.busy && <StatusMessage>{t($ => $.onboarding.working)}</StatusMessage>}
      {pdf.error && <StatusMessage tone="error">{t($ => $.onboarding.importFailed, { error: pdf.error })}</StatusMessage>}
    </>}
    {method === 'external' && <div className="onboarding-fields"><QuietPanel className="onboarding-prompt"><span>{t($ => $.onboarding.externalPrompt)}</span>
      <CopyButton copyLabel={t($ => $.onboarding.copy)} copiedLabel={t($ => $.externalMCP.copied)} onCopy={copyPrompt} resetKey={t($ => $.onboarding.externalPrompt)} /></QuietPanel>
      <Checkbox label={t($ => $.onboarding.externalConfirmed)} checked={s.externalConfirmed} onChange={e => s.setExternalConfirmed(e.target.checked)} />
    </div>}
    {copyFailed && <StatusMessage tone="error">{t($ => $.externalMCP.errors.COPY_FAILED)}</StatusMessage>}
    {s.error && <><StatusMessage tone="error">{s.error}</StatusMessage>{!s.profile && <Button onClick={() => void s.load()}>{t($ => $.settings.retry)}</Button>}</>}
  </div>
}
