import { KnowledgeSettings } from './KnowledgeSettings'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormField, PageHeading, SectionCard, Select, StatusMessage, TextInput } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'
import { mailURLs, type Language, type MailProvider, type ThemePreference } from '../../shared/settings'
import { useSettings, type Notice } from './useSettings'
import { AISettingsSection } from './AISettingsSection'
import { AuditViewerSection } from './AuditViewerSection'
import { ExternalMCPSettings } from './ExternalMCPSettings'
import './settings.css'

export function SettingsPage() {
  const { t } = useTranslation(), { openPage } = useNavigation(), settings = useSettings()
  const [mailError, setMailError] = useState(false)
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
  return <main className="settings-page">
    <div className="settings-content">
      <div className="settings-navigation"><Button variant="ghost" onClick={() => void openPage('home')}>{t($ => $.navigation.goHome)}</Button></div>
      <PageHeading title={t($ => $.navigation.pages.settings)} description={t($ => $.settings.subtitle)} />
      {settings.loading ? <StatusMessage>{t($ => $.settings.loading)}</StatusMessage> : settings.loadFailed || !draft ? <div className="settings-stack">
        <StatusMessage tone="error">{t($ => $.settings.loadFailed)}</StatusMessage><Button onClick={settings.retry}>{t($ => $.settings.retry)}</Button>
      </div> : <div className="settings-sections">
        <SectionCard title={t($ => $.settings.general)} description={t($ => $.settings.generalDescription)}>
          <form data-settings-general className="settings-stack" onSubmit={event => { event.preventDefault(); void settings.save('general') }}>
            <div className="settings-fields">
              <FormField label={t($ => $.settings.language)}>{props => <Select {...props} value={draft.language} disabled={Boolean(saving)} onChange={event => settings.changeLanguage(event.target.value as Language)}>
                <option value="en" lang="en">English</option><option value="zh-CN" lang="zh-CN">简体中文</option>
              </Select>}</FormField>
              <FormField label={t($ => $.settings.appearance)} help={t($ => $.settings.appearanceHelp)}>{props => <Select {...props} value={draft.theme} disabled={Boolean(saving)} onChange={event => settings.changeTheme(event.target.value as ThemePreference)}>
                <option value="light">{t($ => $.settings.light)}</option><option value="dark">{t($ => $.settings.dark)}</option><option value="system">{t($ => $.settings.system)}</option>
              </Select>}</FormField>
            </div>
            <div className="settings-actions">{feedback(notices.general, settings.generalDirty)}<Button variant="primary" type="submit" disabled={!settings.generalDirty || Boolean(saving)}>{saving === 'general' ? t($ => $.settings.saving) : t($ => $.settings.save)}</Button></div>
          </form>
        </SectionCard>
        <AISettingsSection settings={settings} />
        <SectionCard data-settings-mailbox title={t($ => $.settings.mailbox)} description={t($ => $.settings.mailboxDescription)}>
          <form data-settings-mailbox-form className="settings-stack" noValidate onSubmit={event => { event.preventDefault(); submitMailbox() }}>
            <FormField label={t($ => $.settings.mailProvider)}>{props => <Select {...props} value={draft.mailbox.provider} disabled={Boolean(saving)} onChange={event => {
              const provider = event.target.value as MailProvider
              settings.changeMailbox({ provider, url: provider === 'none' ? '' : provider === 'custom' ? draft.mailbox.url : mailURLs[provider] }); setMailError(false)
            }}><option value="none">{t($ => $.settings.none)}</option><option value="gmail">Gmail</option><option value="outlook">Outlook</option><option value="custom">{t($ => $.settings.custom)}</option></Select>}</FormField>
            {draft.mailbox.provider !== 'none' && <FormField label={t($ => $.settings.mailURL)} help={t($ => $.settings.mailHelp)} error={mailError ? t($ => $.settings.mailInvalid) : undefined}>{props => <TextInput {...props} type="url" maxLength={2048} value={draft.mailbox.url} disabled={Boolean(saving)} onChange={event => { settings.changeMailbox({ ...draft.mailbox, url: event.target.value }); setMailError(false) }} />}</FormField>}
            <div className="settings-actions">{feedback(notices.mailbox, settings.mailDirty)}<Button variant="primary" type="submit" disabled={!settings.mailDirty || Boolean(saving)}>{saving === 'mailbox' ? t($ => $.settings.saving) : t($ => $.settings.save)}</Button></div>
          </form>
        </SectionCard>
        <KnowledgeSettings onDirty={settings.setKnowledgeDirty} />
        <ExternalMCPSettings />
        <div className="settings-stack"><StatusMessage>{t($ => $.settings.local)}</StatusMessage><StatusMessage>{t($ => $.settings.localDescription)}</StatusMessage></div>
      </div>}
      <AuditViewerSection />
    </div>
  </main>
}
