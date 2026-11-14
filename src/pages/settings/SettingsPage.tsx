import {
  Button, Divider, FormLayout, Heading, Layout, LayoutContent, LayoutHeader, Section,
  SegmentedControl, SegmentedControlItem, Selector, Stack, Text, TextInput
} from '@astryxdesign/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mailURLs } from '../../shared/settings'
import { useOnboarding } from '../../app/onboarding'
import { useSettings, type Notice } from './useSettings'
import { AISettingsSection } from './AISettingsSection'
import { ExternalMCPSettings } from './ExternalMCPSettings'
import { KnowledgeSettings } from './KnowledgeSettings'
import { SmartPasteSettings } from './SmartPasteSettings'
import './settings.css'

export function SettingsPage() {
  const { t } = useTranslation()
  const settings = useSettings()
  const onboarding = useOnboarding()
  const [mailError, setMailError] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState(false)
  const { draft, saving, notices } = settings
  const locked = Boolean(saving)
  const feedback = (notice: Notice, dirty: boolean) => {
    const message = notice || (dirty ? 'unsaved' : '')
    const error = notice === 'saveFailed'
    return message && <Text as="p" type="supporting" role={error ? 'alert' : 'status'} className={error ? 'error-message' : undefined}>
      {t($ => $.settings[message])}
    </Text>
  }

  function submitMailbox() {
    if (!draft) return
    if (draft.mailbox.provider === 'none') {
      void settings.save('mailbox')
      return
    }
    let valid = false
    try {
      const url = new URL(draft.mailbox.url)
      valid = url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password && draft.mailbox.url.length <= 2048
    } catch { /* Invalid URLs receive field-level feedback. */ }
    setMailError(!valid)
    if (valid) void settings.save('mailbox')
  }

  async function restartOnboarding() {
    setRestarting(true)
    setRestartError(false)
    try {
      await onboarding.restart()
    } catch {
      setRestartError(true)
    } finally {
      setRestarting(false)
    }
  }

  return <Layout className="settings-page" role="main" aria-label={t($ => $.navigation.pages.settings)}
    contentWidth="calc(640px + 2 * var(--spacing-4))" padding={4}
    header={<LayoutHeader><Heading level={1}>{t($ => $.navigation.pages.settings)}</Heading></LayoutHeader>}>
    <LayoutContent>
      {settings.loading ? <Text as="p" type="supporting" role="status">{t($ => $.settings.loading)}</Text>
        : settings.loadFailed || !draft ? <Stack direction="horizontal" align="center" gap={2} wrap="wrap">
          <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.settings.loadFailed)}</Text>
          <Button onClick={settings.retry} label={t($ => $.settings.retry)} />
        </Stack> : <Stack gap={6}>
          <Section variant="transparent" padding={0}>
            <Stack gap={4}>
              <Heading level={2}>{t($ => $.settings.appearance)}</Heading>
              <form data-settings-general onSubmit={event => { event.preventDefault(); void settings.save('general') }}>
                <FormLayout>
                  <Stack gap={1}>
                    <Text type="label">{t($ => $.settings.language)}</Text>
                    <SegmentedControl label={t($ => $.settings.language)} value={draft.language} isDisabled={locked}
                      onChange={value => { if (value === 'zh-CN' || value === 'en') settings.changeLanguage(value) }}>
                      <SegmentedControlItem value="zh-CN" label="简体中文" />
                      <SegmentedControlItem value="en" label="English" />
                    </SegmentedControl>
                  </Stack>
                  <Stack gap={1}>
                    <Text type="label">{t($ => $.settings.theme)}</Text>
                    <SegmentedControl label={t($ => $.settings.theme)} value={draft.theme} isDisabled={locked}
                      onChange={value => { if (value === 'light' || value === 'dark' || value === 'system') settings.changeTheme(value) }}>
                      {(['system', 'light', 'dark'] as const).map(mode =>
                        <SegmentedControlItem key={mode} value={mode} label={t($ => $.onboarding[mode])} />)}
                    </SegmentedControl>
                  </Stack>
                  <Stack direction="horizontal" align="center" gap={2} wrap="wrap">
                    <Button variant="primary" type="submit" isDisabled={!settings.generalDirty || locked}
                      label={saving === 'general' ? t($ => $.settings.saving) : t($ => $.settings.save)} />
                    {feedback(notices.general, settings.generalDirty)}
                  </Stack>
                </FormLayout>
              </form>
            </Stack>
          </Section>
          <Divider />
          <AISettingsSection aiSettings={draft.ai} onSaved={settings.acceptAI} onDirty={settings.setAIDirty} disabled={locked} />
          <Divider />
          <ExternalMCPSettings />
          <Divider />
          <SmartPasteSettings settings={settings} />
          <Divider />
          <KnowledgeSettings onDirty={settings.setKnowledgeDirty} />
          <Divider />
          <Section variant="transparent" padding={0} data-settings-mailbox>
            <Stack gap={4}>
              <Heading level={2}>{t($ => $.settings.mailbox)}</Heading>
              <form data-settings-mailbox-form noValidate onSubmit={event => { event.preventDefault(); submitMailbox() }}>
                <FormLayout>
                  <Selector label={t($ => $.settings.mailProvider)} value={draft.mailbox.provider} isDisabled={locked}
                    options={[
                      { value: 'none', label: t($ => $.settings.none) },
                      { value: 'gmail', label: 'Gmail' },
                      { value: 'outlook', label: 'Outlook' },
                      { value: 'custom', label: t($ => $.settings.custom) }
                    ]}
                    onChange={provider => {
                      if (provider !== 'none' && provider !== 'custom' && provider !== 'gmail' && provider !== 'outlook') return
                      const url = provider === 'none' ? '' : provider === 'custom' ? draft.mailbox.url : mailURLs[provider]
                      settings.changeMailbox({ provider, url })
                      setMailError(false)
                    }} />
                  {draft.mailbox.provider !== 'none' && <TextInput label={t($ => $.settings.mailURL)}
                    status={mailError ? { type: 'error', message: t($ => $.settings.mailInvalid) } : undefined}
                    type="url" ref={input => { if (input) input.maxLength = 2048 }} value={draft.mailbox.url} isDisabled={locked}
                    onChange={url => { settings.changeMailbox({ ...draft.mailbox, url }); setMailError(false) }} />}
                  <Stack direction="horizontal" align="center" gap={2} wrap="wrap">
                    <Button variant="primary" type="submit" isDisabled={!settings.mailDirty || locked}
                      label={saving === 'mailbox' ? t($ => $.settings.saving) : t($ => $.settings.save)} />
                    {feedback(notices.mailbox, settings.mailDirty)}
                  </Stack>
                </FormLayout>
              </form>
            </Stack>
          </Section>
          <Divider />
          <Section variant="transparent" padding={0}>
            <Stack gap={4}>
              <Heading level={2}>{t($ => $.settings.setup)}</Heading>
              <Stack direction="horizontal" align="center" gap={2} wrap="wrap">
                <Button data-restart-onboarding isLoading={restarting} isDisabled={settings.dirty || locked || restarting}
                  onClick={() => void restartOnboarding()} label={t($ => $.settings.restartOnboarding)} />
                {restartError && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.settings.restartFailed)}</Text>}
              </Stack>
            </Stack>
          </Section>
        </Stack>}
    </LayoutContent>
  </Layout>
}
