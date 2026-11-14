import { useTranslation } from 'react-i18next'
import { SMART_PASTE_CONFIG_LIMIT, SMART_PASTE_PROMPT_LIMIT, SMART_PASTE_TITLE_LIMIT, smartPasteSettings, type SmartPasteConfig } from '../../shared/smart-paste'
import { ActionRow, Button, FormField, SectionCard, StatusMessage, TextArea, TextInput } from '../../shared/ui'
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
  return <SectionCard defaultCollapsed title={t($ => $.smartPaste.title)} description={t($ => $.smartPaste.description)}>
    <form className="settings-stack" data-settings-smart-paste onSubmit={event => { event.preventDefault(); void settings.save('smartPaste') }}>
      {configs.map(config => <div className="settings-stack" key={config.id}>
        <FormField label={t($ => $.smartPaste.configTitle)}>{props => <TextInput {...props} required
          value={config.title} maxLength={SMART_PASTE_TITLE_LIMIT} disabled={Boolean(saving)}
          onChange={event => change(config.id, { title: event.target.value })} />}</FormField>
        <FormField label={t($ => $.smartPaste.prompt)}>{props => <TextArea {...props} required
          value={config.prompt} maxLength={SMART_PASTE_PROMPT_LIMIT} disabled={Boolean(saving)}
          onChange={event => change(config.id, { prompt: event.target.value })} />}</FormField>
        <ActionRow><Button type="button" variant="ghost" disabled={Boolean(saving)}
          onClick={() => settings.changeSmartPaste({ configs: configs.filter(item => item.id !== config.id) })}>{t($ => $.smartPaste.remove)}</Button></ActionRow>
      </div>)}
      <ActionRow>
        {notice ? <StatusMessage tone={notice === 'saved' ? 'success' : 'error'}>{t($ => $.settings[notice])}</StatusMessage>
          : smartPasteDirty && <StatusMessage>{t($ => $.settings.unsaved)}</StatusMessage>}
        <Button type="button" disabled={Boolean(saving) || configs.length >= SMART_PASTE_CONFIG_LIMIT}
          onClick={() => settings.changeSmartPaste({ configs: [...configs, { id: crypto.randomUUID(), title: '', prompt: '' }] })}>{t($ => $.smartPaste.add)}</Button>
        <Button variant="primary" type="submit" disabled={!smartPasteDirty || Boolean(saving)}>{saving === 'smartPaste' ? t($ => $.settings.saving) : t($ => $.settings.save)}</Button>
      </ActionRow>
    </form>
  </SectionCard>
}
