import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, FormField, PageHeading, SectionCard, Select, StatusMessage, TextInput } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'
import { mailURLs, type Language, type MailProvider } from '../../shared/settings'
import { useSettings, type Notice } from './useSettings'
import './settings.css'

export function SettingsPage() {
  const { t } = useTranslation(), { openPage } = useNavigation(), settings = useSettings()
  const [confirmDelete, setConfirmDelete] = useState(false), [mailError, setMailError] = useState(false)
  const { draft, saving, notices, keyStatus } = settings
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
          <form className="settings-stack" onSubmit={event => { event.preventDefault(); void settings.save('general') }}>
            <div className="settings-fields">
              <FormField label={t($ => $.settings.language)}>{props => <Select {...props} value={draft.language} disabled={Boolean(saving)} onChange={event => settings.changeLanguage(event.target.value as Language)}>
                <option value="en" lang="en">English</option><option value="zh-CN" lang="zh-CN">简体中文</option>
              </Select>}</FormField>
              <FormField label={t($ => $.settings.appearance)} help={t($ => $.settings.lightHelp)}>{props => <Select {...props} value="light" disabled><option value="light">{t($ => $.settings.light)}</option></Select>}</FormField>
            </div>
            <div className="settings-actions">{feedback(notices.general, settings.generalDirty)}<Button variant="primary" type="submit" disabled={!settings.generalDirty || Boolean(saving)}>{saving === 'general' ? t($ => $.settings.saving) : t($ => $.settings.save)}</Button></div>
          </form>
        </SectionCard>
        <SectionCard title={t($ => $.settings.ai)} description={t($ => $.settings.aiDescription)}>
          <form className="settings-stack" onSubmit={event => { event.preventDefault(); void settings.saveKey() }}>
            <div className="settings-provider"><span>OpenAI</span><StatusMessage tone={keyStatus.configured ? 'success' : 'neutral'}>{keyStatus.configured ? t($ => $.settings.configured) : t($ => $.settings.notConfigured)}</StatusMessage></div>
            <FormField label={t($ => $.settings.apiKey)} help={t($ => $.settings.keyHelp)}>{props => <TextInput {...props} type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={settings.key} placeholder={t($ => $.settings.keyPlaceholder)} disabled={Boolean(saving) || !keyStatus.available} onChange={event => settings.changeKey(event.target.value)} />}</FormField>
            <StatusMessage tone="info">{t($ => $.settings.aiPlanned)}</StatusMessage>
            {!keyStatus.available && <StatusMessage tone="error">{t($ => $.settings.encryptionUnavailable)}</StatusMessage>}
            <div className="settings-actions">{feedback(notices.key, settings.key.length > 0)}<div className="settings-buttons">
              {keyStatus.configured && <Button variant="danger" disabled={Boolean(saving)} onClick={() => setConfirmDelete(true)}>{t($ => $.settings.deleteKey)}</Button>}
              <Button variant="primary" type="submit" disabled={!settings.key.trim() || /\s/.test(settings.key.trim()) || Boolean(saving) || !keyStatus.available}>{saving === 'key' ? t($ => $.settings.saving) : keyStatus.configured ? t($ => $.settings.replaceKey) : t($ => $.settings.saveKey)}</Button>
            </div></div>
          </form>
        </SectionCard>
        <SectionCard title={t($ => $.settings.mailbox)} description={t($ => $.settings.mailboxDescription)}>
          <form className="settings-stack" noValidate onSubmit={event => { event.preventDefault(); submitMailbox() }}>
            <FormField label={t($ => $.settings.mailProvider)}>{props => <Select {...props} value={draft.mailbox.provider} disabled={Boolean(saving)} onChange={event => {
              const provider = event.target.value as MailProvider
              settings.changeMailbox({ provider, url: provider === 'none' ? '' : provider === 'custom' ? draft.mailbox.url : mailURLs[provider] }); setMailError(false)
            }}><option value="none">{t($ => $.settings.none)}</option><option value="gmail">Gmail</option><option value="outlook">Outlook</option><option value="custom">{t($ => $.settings.custom)}</option></Select>}</FormField>
            {draft.mailbox.provider !== 'none' && <FormField label={t($ => $.settings.mailURL)} help={t($ => $.settings.mailHelp)} error={mailError ? t($ => $.settings.mailInvalid) : undefined}>{props => <TextInput {...props} type="url" maxLength={2048} value={draft.mailbox.url} disabled={Boolean(saving)} onChange={event => { settings.changeMailbox({ ...draft.mailbox, url: event.target.value }); setMailError(false) }} />}</FormField>}
            <div className="settings-actions">{feedback(notices.mailbox, settings.mailDirty)}<Button variant="primary" type="submit" disabled={!settings.mailDirty || Boolean(saving)}>{saving === 'mailbox' ? t($ => $.settings.saving) : t($ => $.settings.save)}</Button></div>
          </form>
        </SectionCard>
        <div className="settings-stack"><StatusMessage>{t($ => $.settings.local)}</StatusMessage><StatusMessage>{t($ => $.settings.localDescription)}</StatusMessage></div>
      </div>}
      <Dialog open={confirmDelete} title={t($ => $.settings.deleteTitle)} description={t($ => $.settings.deleteDescription)} onClose={() => setConfirmDelete(false)}>
        <Button autoFocus onClick={() => setConfirmDelete(false)}>{t($ => $.settings.cancel)}</Button>
        <Button variant="danger" onClick={() => { setConfirmDelete(false); void settings.saveKey(true) }}>{t($ => $.settings.deleteKey)}</Button>
      </Dialog>
    </div>
  </main>
}
