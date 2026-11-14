import { Button, Heading, Section, SegmentedControl, SegmentedControlItem, Selector, Stack, Text, TextInput } from '@astryxdesign/core'
import { KnowledgeSettings } from './KnowledgeSettings'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mailURLs } from '../../shared/settings'
import { useOnboarding } from '../../app/onboarding'
import { useSettings, type Notice } from './useSettings'
import { AISettingsSection } from './AISettingsSection'
import { ExternalMCPSettings } from './ExternalMCPSettings'
import { SmartPasteSettings } from './SmartPasteSettings'
import './settings.css'

export function SettingsPage() {
  const { t } = useTranslation(), settings = useSettings()
  const [mailError, setMailError] = useState(false)
  const onboarding = useOnboarding(), [restarting, setRestarting] = useState(false), [restartError, setRestartError] = useState(false)
  const { draft, saving, notices } = settings
  const feedback = (notice: Notice, dirty: boolean) => notice
    ? <Text as="p" type="supporting" role="status">{t($ => $.settings[notice])}</Text>
    : dirty ? <Text as="p" type="supporting" role="status">{t($ => $.settings.unsaved)}</Text> : null
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
      {settings.loading ? <Text as="p" type="supporting" role="status">{t($ => $.settings.loading)}</Text> : settings.loadFailed || !draft ? <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
        <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.settings.loadFailed)}</Text><Button onClick={settings.retry} label={t($ => $.settings.retry)} />
      </Stack> : <div className="settings-sections">
        <Section className="feature-section" padding={0}><details onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.onboarding.appearance)}</Heading></summary>
      <div className="feature-section-body">{t($ => $.settings.generalDescription) && <p>{t($ => $.settings.generalDescription)}</p>}
          <form data-settings-general className="settings-stack" onSubmit={event => { event.preventDefault(); void settings.save('general') }}>
            <Stack gap={4}>
            <Stack gap={1}>
              <Text type="label">{t($ => $.onboarding.language)}</Text>
              <SegmentedControl label={t($ => $.onboarding.language)} value={draft.language} isDisabled={Boolean(saving)}
                onChange={value => { if (value === 'zh-CN' || value === 'en') settings.changeLanguage(value) } }>
                <SegmentedControlItem value="zh-CN" label="简体中文" />
                <SegmentedControlItem value="en" label="English" />
              </SegmentedControl>
            </Stack>
            <Stack gap={1}>
              <Text type="label">{t($ => $.onboarding.background)}</Text>
              <SegmentedControl label={t($ => $.onboarding.background)} value={draft.theme} isDisabled={Boolean(saving)}
                onChange={value => { if (value === 'light' || value === 'dark' || value === 'system') settings.changeTheme(value) } }>
                {(['system', 'light', 'dark'] as const).map(mode =>
                  <SegmentedControlItem key={mode} value={mode} label={t($ => $.onboarding[mode])} />)}
              </SegmentedControl>
            </Stack>
          </Stack>
            <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">{feedback(notices.general, settings.generalDirty)}<Button variant="primary" type="submit" isDisabled={!settings.generalDirty || Boolean(saving)} label={saving === 'general' ? t($ => $.settings.saving) : t($ => $.settings.save)} /></Stack>
          </form>
          <Text as="p" type="supporting" role="status">{t($ => $.onboarding.restartHelp)}</Text>
          <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button data-restart-onboarding isDisabled={settings.dirty || Boolean(saving) || restarting} onClick={() => {
            setRestarting(true); setRestartError(false)
            void onboarding.restart().catch(() => setRestartError(true)).finally(() => setRestarting(false))
          }} label={t($ => $.onboarding.restart)} /></Stack>
          {restartError && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.settings.saveFailed)}</Text>}
        </div></details></Section>
        <AISettingsSection aiSettings={draft.ai} onSaved={settings.acceptAI} onDirty={settings.setAIDirty} disabled={Boolean(saving)} />
        <SmartPasteSettings settings={settings} />
        <Section className="feature-section" padding={0}><details data-settings-mailbox  onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.settings.mailbox)}</Heading></summary>
      <div className="feature-section-body">{t($ => $.settings.mailboxDescription) && <p>{t($ => $.settings.mailboxDescription)}</p>}
          <form data-settings-mailbox-form className="settings-stack" noValidate onSubmit={event => { event.preventDefault(); submitMailbox() }}>
            <Selector label={t($ => $.settings.mailProvider)} value={draft.mailbox.provider} isDisabled={Boolean(saving)} onChange={event => {
              const provider = event
              if (provider !== 'none' && provider !== 'custom' && provider !== 'gmail' && provider !== 'outlook') return
              settings.changeMailbox({ provider, url: provider === 'none' ? '' : provider === 'custom' ? draft.mailbox.url : mailURLs[provider] }); setMailError(false)
            }}  options={[({ value: "none", label: t($ => $.settings.none) }), ({ value: "gmail", label: "Gmail" }), ({ value: "outlook", label: "Outlook" }), ({ value: "custom", label: t($ => $.settings.custom) })]} />
            {draft.mailbox.provider !== 'none' && <TextInput label={t($ => $.settings.mailURL)} description={t($ => $.settings.mailHelp)} status={(mailError ? t($ => $.settings.mailInvalid) : undefined) ? { type: 'error', message: mailError ? t($ => $.settings.mailInvalid) : undefined } : undefined} type="url" ref={input => { if (input) { input.maxLength = 2048 } }} value={draft.mailbox.url} isDisabled={Boolean(saving)} onChange={event => { settings.changeMailbox({ ...draft.mailbox, url: event }); setMailError(false) }} />}
            <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">{feedback(notices.mailbox, settings.mailDirty)}<Button variant="primary" type="submit" isDisabled={!settings.mailDirty || Boolean(saving)} label={saving === 'mailbox' ? t($ => $.settings.saving) : t($ => $.settings.save)} /></Stack>
          </form>
        </div></details></Section>
        <KnowledgeSettings onDirty={settings.setKnowledgeDirty} />
        <ExternalMCPSettings />
      </div>}
    </div>
  </main>
}
