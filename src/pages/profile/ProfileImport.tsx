import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, DetailsList, Dialog, SectionCard, StatusMessage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'
import type { Profile } from '../../domain/candidate/candidate.types'
import type { en } from '../../shared/i18n/locales/en'
import { useProfileImport } from './useProfileImport'
import { hasPending } from './import-state'
import { ImportReview } from './ImportReview'

export function ProfileImport({ profile, onDirty, onSaved, disabled }: { profile: Profile | null; onDirty: (dirty: boolean) => void; onSaved: (profile: Profile) => Promise<void>; disabled: boolean }) {
  const { t } = useTranslation(), { openPage } = useNavigation(), state = useProfileImport(profile, onSaved)
  const [discard, setDiscard] = useState(false)
  const busy = ['selecting', 'extracting', 'parsing'].includes(state.stage), dirty = busy || state.saving || Boolean(state.draft && hasPending(state.draft))
  useEffect(() => { onDirty(dirty); return () => onDirty(false) }, [dirty, onDirty])
  const provider = state.settings?.providers.find(provider => provider.id === state.choice?.providerId)
  const configured = Boolean(provider && state.choice && provider.models.includes(state.choice.modelId))
  const error = state.error === 'nameRequired' ? t($ => $.profile.nameRequired) : state.error === 'noConfirmed' ? t($ => $.profile.noConfirmed)
    : t($ => $.profile.errors[state.error as keyof typeof en.profile.errors], { defaultValue: t($ => $.ai.errors[state.error as keyof typeof en.ai.errors], { defaultValue: t($ => $.errors.actionFailed) }) })
  return <SectionCard title={t($ => $.profile.importTitle)} description={t($ => $.profile.importHelp)}><div className="profile-stack">
    {configured ? <DetailsList items={[{ label: t($ => $.profile.provider), value: provider!.name }, { label: t($ => $.profile.model), value: state.choice!.modelId }]} /> : <><StatusMessage>{t($ => $.profile.noAI)}</StatusMessage><div><Button onClick={() => void openPage('settings')}>{t($ => $.profile.settings)}</Button></div></>}
    {state.error && <StatusMessage tone="error">{error}</StatusMessage>}
    {state.saved && <StatusMessage tone="success">{t($ => $.profile.importSaved)}</StatusMessage>}
    {busy && <StatusMessage>{state.stage === 'parsing' ? t($ => $.profile.parsing) : state.progress.pages ? t($ => $.profile.progress, state.progress) : t($ => $.profile.extracting)}</StatusMessage>}
    <div className="profile-actions">
      {!state.hasFile && !busy && <Button variant="primary" disabled={disabled || !configured} onClick={() => void state.upload()}>{t($ => $.profile.upload)}</Button>}
      {state.stage === 'failed' && state.hasFile && <Button disabled={disabled} onClick={() => void state.start()}>{t($ => $.profile.parseAgain)}</Button>}
      {busy && state.stage !== 'selecting' && <Button onClick={state.stop}>{t($ => $.profile.stop)}</Button>}
      {state.hasFile && <Button disabled={state.saving} onClick={() => setDiscard(true)}>{t($ => $.profile.discard)}</Button>}
      {state.draft && <Button variant="primary" disabled={disabled || state.saving} onClick={() => void state.save()}>{state.saving ? t($ => $.profile.saving) : t($ => $.profile.saveConfirmed)}</Button>}
    </div>
    {state.draft && <ImportReview draft={state.draft} setDraft={state.setDraft} profile={profile} disabled={disabled || state.saving || state.frozen} />}
    <Dialog open={discard} title={t($ => $.profile.discardImportTitle)} description={t($ => $.profile.discardImportDescription)} onClose={() => setDiscard(false)}><Button onClick={() => setDiscard(false)}>{t($ => $.profile.cancel)}</Button><Button variant="danger" onClick={() => { setDiscard(false); void state.discard() }}>{t($ => $.profile.discard)}</Button></Dialog>
  </div></SectionCard>
}
