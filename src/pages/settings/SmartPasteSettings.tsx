import { Button, Divider, FormLayout, Heading, Section, Stack, Text, TextArea, TextInput } from '@astryxdesign/core'
import { useTranslation } from 'react-i18next'
import { SMART_PASTE_CONFIG_LIMIT, SMART_PASTE_PROMPT_LIMIT, SMART_PASTE_TITLE_LIMIT, smartPasteSettings, type SmartPasteConfig } from '../../shared/smart-paste'
import type { useSettings } from './useSettings'

export function SmartPasteSettings({ settings }: { settings: ReturnType<typeof useSettings> }) {
  const { t } = useTranslation()
  if (!settings.draft) return null
  const { configs } = smartPasteSettings(settings.draft)
  const { saving, smartPasteDirty } = settings
  const notice = settings.notices.smartPaste
  const error = notice === 'saveFailed' || notice === 'invalidSmartPaste'
  const change = (id: string, patch: Partial<SmartPasteConfig>) => settings.changeSmartPaste({
    configs: configs.map(config => config.id === id ? { ...config, ...patch } : config)
  })

  return <Section variant="transparent" padding={0}>
    <Stack gap={4}>
      <Heading level={2}>{t($ => $.smartPaste.title)}</Heading>
      <Text as="p" type="supporting" color="secondary">{t($ => $.smartPaste.description)}</Text>
      <form data-settings-smart-paste onSubmit={event => { event.preventDefault(); void settings.save('smartPaste') }}>
        <Stack gap={4}>
          {configs.length > 0 && <Stack as="ul" className="settings-list" role="list" gap={4}>
            {configs.map((config, index) => <Stack as="li" gap={4} key={config.id}>
              {index > 0 && <Divider />}
              <FormLayout>
                <TextInput label={t($ => $.smartPaste.configTitle)}
                  value={config.title} isRequired ref={input => { if (input) { input.required = true; input.maxLength = SMART_PASTE_TITLE_LIMIT } }}
                  isDisabled={Boolean(saving)} onChange={title => change(config.id, { title })} />
                <TextArea label={t($ => $.smartPaste.prompt)}
                  value={config.prompt} isRequired ref={input => { if (input) { input.required = true; input.maxLength = SMART_PASTE_PROMPT_LIMIT } }}
                  isDisabled={Boolean(saving)} onChange={prompt => change(config.id, { prompt })} />
                <Stack direction="horizontal">
                  <Button type="button" variant="ghost" isDisabled={Boolean(saving)} label={t($ => $.smartPaste.remove)}
                    onClick={() => settings.changeSmartPaste({ configs: configs.filter(item => item.id !== config.id) })} />
                </Stack>
              </FormLayout>
            </Stack>)}
          </Stack>}
          <Stack direction="horizontal" align="center" gap={2} wrap="wrap">
            <Button variant="primary" type="submit" isDisabled={!smartPasteDirty || Boolean(saving)}
              label={saving === 'smartPaste' ? t($ => $.settings.saving) : t($ => $.settings.save)} />
            <Button type="button" isDisabled={Boolean(saving) || configs.length >= SMART_PASTE_CONFIG_LIMIT}
              onClick={() => settings.changeSmartPaste({ configs: [...configs, { id: crypto.randomUUID(), title: '', prompt: '' }] })}
              label={t($ => $.smartPaste.add)} />
            {(notice || smartPasteDirty) && <Text as="p" type="supporting" role={error ? 'alert' : 'status'} className={error ? 'error-message' : undefined}>
              {notice ? t($ => $.settings[notice]) : t($ => $.settings.unsaved)}
            </Text>}
          </Stack>
        </Stack>
      </form>
    </Stack>
  </Section>
}
