import { KnowledgeSettings } from './KnowledgeSettings'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionRow, Button, FormField, LanguageBackground, SectionCard, Select, StatusMessage, TextInput } from '../../shared/ui'
import { mailURLs, type MailProvider } from '../../shared/settings'
import { useOnboarding } from '../../app/onboarding'
import { useSettings, type Notice } from './useSettings'
import { AISettingsSection } from './AISettingsSection'
import { AuditViewerSection } from './AuditViewerSection'
import { ExternalMCPSettings } from './ExternalMCPSettings'
import { SmartPasteSettings } from './SmartPasteSettings'
import './settings.css'

export function SettingsPage() {
  const { t } = useTranslation(), settings = useSettings()
  const [mailError, setMailError] = useState(false)
  const onboarding = useOnboarding(), [restarting, setRestarting] = useState(false), [restartError, setRestartError] = useState(false)
  const { draft, saving, notices } = settings
  const feedback = (notice: Notice, dirty: boolean) => notice
    ? <StatusMessage tone={notice === 'saveFailed' || notice === 'encryptionUnavailable' ? 'error' : 'success'}>{t($ => $.settings[notice])}</StatusMessage>
    : dirty ? <StatusMessage>{t($ => $.settings.unsaved)}</StatusMessage> : null
  const submitMailbox = () => {
    if (!draft) return
    let valid = draft.mailbox.provider === 'none'
    try {
      const url = new URL(draft.mailbox.url)
      valid = url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password && draft.mailbox.url.length <= 2048
    } catch { /* Empty/invalid URLs receive field-level feedback. */ }
    setMailError(!valid)
    if (valid) void settings.save('mailbox')
  }
  return <main className="settings-page" aria-label={t($ => $.navigation.pages.settings)}>
    <div className="settings-content">
      {settings.loading ? <StatusMessage>{t($ => $.settings.loading)}</StatusMessage> : settings.loadFailed || !draft ? <ActionRow>
        <StatusMessage tone="error">{t($ => $.settings.loadFailed)}</StatusMessage><Button onClick={settings.retry}>{t($ => $.settings.retry)}</Button>
      </ActionRow> : <div className="settings-sections">
        <SectionCard defaultCollapsed title={t($ => $.onboarding.appearance)} description={t($ => $.settings.generalDescription)}>
          <form data-settings-general className="settings-stack" onSubmit={event => { event.preventDefault(); void settings.save('general') }}>
            <LanguageBackground language={draft.language} theme={draft.theme} disabled={Boolean(saving)}
              labels={{ language: t($ => $.onboarding.language), background: t($ => $.onboarding.background), system: t($ => $.onboarding.system), light: t($ => $.onboarding.light), dark: t($ => $.onboarding.dark) }}
              onLanguageChange={settings.changeLanguage} onThemeChange={settings.changeTheme} />
            <ActionRow>{feedback(notices.general, settings.generalDirty)}<Button variant="primary" type="submit" disabled={!settings.generalDirty || Boolean(saving)}>{saving === 'general' ? t($ => $.settings.saving) : t($ => $.settings.save)}</Button></ActionRow>
          </form>
          <StatusMessage>{t($ => $.onboarding.restartHelp)}</StatusMessage>
          <ActionRow><Button data-restart-onboarding disabled={settings.dirty || Boolean(saving) || restarting} onClick={() => {
            setRestarting(true); setRestartError(false)
            void onboarding.restart().catch(() => setRestartError(true)).finally(() => setRestarting(false))
          }}>{t($ => $.onboarding.restart)}</Button></ActionRow>
          {restartError && <StatusMessage tone="error">{t($ => $.settings.saveFailed)}</StatusMessage>}
        </SectionCard>
        <AISettingsSection settings={settings} />
        <SmartPasteSettings settings={settings} />
        <SectionCard defaultCollapsed data-settings-mailbox title={t($ => $.settings.mailbox)} description={t($ => $.settings.mailboxDescription)}>
          <form data-settings-mailbox-form className="settings-stack" noValidate onSubmit={event => { event.preventDefault(); submitMailbox() }}>
            <FormField label={t($ => $.settings.mailProvider)}>{props => <Select {...props} value={draft.mailbox.provider} disabled={Boolean(saving)} onChange={event => {
              const provider = event.target.value as MailProvider
              settings.changeMailbox({ provider, url: provider === 'none' ? '' : provider === 'custom' ? draft.mailbox.url : mailURLs[provider] }); setMailError(false)
            }}><option value="none">{t($ => $.settings.none)}</option><option value="gmail">Gmail</option><option value="outlook">Outlook</option><option value="custom">{t($ => $.settings.custom)}</option></Select>}</FormField>
            {draft.mailbox.provider !== 'none' && <FormField label={t($ => $.settings.mailURL)} help={t($ => $.settings.mailHelp)} error={mailError ? t($ => $.settings.mailInvalid) : undefined}>{props => <TextInput {...props} type="url" maxLength={2048} value={draft.mailbox.url} disabled={Boolean(saving)} onChange={event => { settings.changeMailbox({ ...draft.mailbox, url: event.target.value }); setMailError(false) }} />}</FormField>}
            <ActionRow>{feedback(notices.mailbox, settings.mailDirty)}<Button variant="primary" type="submit" disabled={!settings.mailDirty || Boolean(saving)}>{saving === 'mailbox' ? t($ => $.settings.saving) : t($ => $.settings.save)}</Button></ActionRow>
          </form>
        </SectionCard>
        <KnowledgeSettings onDirty={settings.setKnowledgeDirty} />
        <ExternalMCPSettings />
      </div>}
      <AuditViewerSection />
    </div>
  </main>
}
