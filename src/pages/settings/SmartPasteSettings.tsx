import { Button, Heading, Section, Stack, Text, TextArea, TextInput } from '@astryxdesign/core'
import { useTranslation } from 'react-i18next'
import { SMART_PASTE_CONFIG_LIMIT, SMART_PASTE_PROMPT_LIMIT, SMART_PASTE_TITLE_LIMIT, smartPasteSettings, type SmartPasteConfig } from '../../shared/smart-paste'
import type { useSettings } from './useSettings'

export function SmartPasteSettings({ settings }: { settings: ReturnType<typeof useSettings> }) {
  const { t } = useTranslation()
  if (!settings.draft) return null
  const { configs } = smartPasteSettings(settings.draft)
  const { saving, smartPasteDirty } = settings
  const notice = settings.notices.smartPaste
  const change = (id: string, patch: Partial<SmartPasteConfig>) => settings.changeSmartPaste({
    configs: configs.map(config => config.id === id ? { ...config, ...patch } : config)
  })
  return <Section className="feature-section" padding={0}><details onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.smartPaste.title)}</Heading></summary>
      <div className="feature-section-body">{t($ => $.smartPaste.description) && <p>{t($ => $.smartPaste.description)}</p>}
    <form className="settings-stack" data-settings-smart-paste onSubmit={event => { event.preventDefault(); void settings.save('smartPaste') }}>
      {configs.map(config => <div className="settings-stack" key={config.id}>
        <TextInput label={t($ => $.smartPaste.configTitle)}
          value={config.title} ref={input => { if (input) { input.required = true; input.maxLength = SMART_PASTE_TITLE_LIMIT } }} isDisabled={Boolean(saving)}
          onChange={event => change(config.id, { title: event })} />
        <TextArea label={t($ => $.smartPaste.prompt)} ref={input => { if (input) { input.required = true; input.maxLength = SMART_PASTE_PROMPT_LIMIT } }}
          value={config.prompt}  isDisabled={Boolean(saving)}
          onChange={event => change(config.id, { prompt: event })} />
        <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button type="button" variant="ghost" isDisabled={Boolean(saving)}
          onClick={() => settings.changeSmartPaste({ configs: configs.filter(item => item.id !== config.id) })} label={t($ => $.smartPaste.remove)} /></Stack>
      </div>)}
      <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
        {notice ? <Text as="p" type="supporting" role="status">{t($ => $.settings[notice])}</Text>
          : smartPasteDirty && <Text as="p" type="supporting" role="status">{t($ => $.settings.unsaved)}</Text>}
        <Button type="button" isDisabled={Boolean(saving) || configs.length >= SMART_PASTE_CONFIG_LIMIT}
          onClick={() => settings.changeSmartPaste({ configs: [...configs, { id: crypto.randomUUID(), title: '', prompt: '' }] })} label={t($ => $.smartPaste.add)} />
        <Button variant="primary" type="submit" isDisabled={!smartPasteDirty || Boolean(saving)} label={saving === 'smartPaste' ? t($ => $.settings.saving) : t($ => $.settings.save)} />
      </Stack>
    </form>
  </div></details></Section>
}
