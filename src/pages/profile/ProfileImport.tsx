import { Button, CheckboxInput, Dialog, DialogHeader, Heading, MetadataList, MetadataListItem, Section, Stack, Text } from '@astryxdesign/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const error = state.error === 'noContent' ? t($ => $.profile.noContent)
    : t($ => $.profile.errors[state.error as keyof typeof en.profile.errors], { defaultValue: t($ => $.ai.errors[state.error as keyof typeof en.ai.errors], { defaultValue: t($ => $.errors.actionFailed) }) })
  return <>
    <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.profile.importTitle)}</Heading></summary>
      <div className="feature-section-body">{t($ => $.profile.importHelp) && <p>{t($ => $.profile.importHelp)}</p>}<div className="profile-stack">
      {configured ? <MetadataList>{([{ label: t($ => $.profile.provider), value: provider!.name }, { label: t($ => $.profile.model), value: state.choice!.modelId }]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList> : <><Text as="p" type="supporting" role="status">{t($ => $.profile.noAI)}</Text><Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button onClick={() => void openPage('settings')} label={t($ => $.profile.settings)} /></Stack></>}
      {state.error && <Text as="p" type="supporting" role="alert" className="error-message">{error}</Text>}
      {state.saved && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.profile.importSaved)}</Text>}
      {busy && <Text as="p" type="supporting" role="status">{state.stage === 'parsing' ? t($ => $.profile.parsing) : state.progress.pages ? t($ => $.profile.progress, state.progress) : t($ => $.profile.extracting)}</Text>}
      {!state.hasFile && profile && <CheckboxInput label={t($ => $.profile.appendCurrent)} value={state.append} isDisabled={disabled || busy} onChange={event => state.setAppend(event)} />}
      <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
        {!state.hasFile && !busy && <Button variant="primary" isDisabled={disabled || !configured} onClick={() => void state.upload()} label={t($ => $.profile.upload)} />}
        {state.stage === 'failed' && state.hasFile && <Button isDisabled={disabled} onClick={() => void state.start(state.retryable)} label={state.retryable ? t($ => $.profile.parseAgain) : t($ => $.profile.parseAgain)} />}
        {busy && state.stage !== 'selecting' && <Button onClick={state.stop} label={t($ => $.profile.stop)} />}
        {state.hasFile && <Button isDisabled={state.saving} onClick={() => setDiscard(true)} label={t($ => $.profile.discard)} />}
        {state.draft && <Button variant="primary" isDisabled={disabled || state.saving} onClick={() => void state.save()} label={state.saving ? t($ => $.profile.saving) : t($ => $.profile.saveImport)} />}
      </Stack>
      <Dialog  isOpen={discard} onOpenChange={() => setDiscard(false)} aria-label={t($ => $.profile.discardImportTitle)} width={448} purpose="form">
      <DialogHeader title={t($ => $.profile.discardImportTitle)} subtitle={t($ => $.profile.discardImportDescription)} />
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row"><Button onClick={() => setDiscard(false)} label={t($ => $.profile.cancel)} /><Button variant="destructive" onClick={() => { setDiscard(false); void state.discard() }} label={t($ => $.profile.discard)} /></Stack>
    </Dialog>
    </div></div></details></Section>
    {state.draft && <ImportReview draft={state.draft} setDraft={state.setDraft} profile={state.append ? profile : null} disabled={disabled || state.saving || state.frozen} />}
  </>
}
