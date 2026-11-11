import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import { AIConnectionEditor } from '../../app/ai/AIConnectionEditor'
import { useAIConnection } from '../../app/ai/useAIConnection'
import type { AIProvider, AISettings } from '../../shared/ai'
import { ActionRow, Button, Dialog, FormField, SectionCard, Select, StatusMessage } from '../../shared/ui'
import type { useSettings } from './useSettings'

type Settings = ReturnType<typeof useSettings>
export function AISettingsSection({ settings }: { settings: Settings }) {
  return settings.draft && <AISettings ai={settings.draft.ai} settings={settings} />
}

function AISettings({ ai, settings }: { ai: AISettings; settings: Settings }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(ai.default?.providerId ?? ai.providers[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const provider = ai.providers.find(entry => entry.id === selected)
  const disabled = busy || Boolean(settings.saving)
  return <SectionCard defaultCollapsed title={t($ => $.settings.ai)} description={t($ => $.settings.aiDescription)}>
    <div className="settings-stack" data-ai-config>
      <FormField label={t($ => $.settings.provider)}>{props => <Select {...props} disabled={disabled} value={selected} onChange={event => setSelected(event.target.value)}>
        {!provider && <option value="">{t($ => $.settings.newProvider)}</option>}
        {ai.providers.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </Select>}</FormField>
      <ActionRow><Button disabled={disabled || !provider || ai.providers.length >= 20} onClick={() => setSelected('')}>{t($ => $.settings.addProvider)}</Button></ActionRow>
      <StatusMessage>{ai.default ? t($ => $.settings.currentDefault, { provider: ai.providers.find(entry => entry.id === ai.default?.providerId)?.name ?? '', model: ai.default.modelId }) : t($ => $.settings.noDefault)}</StatusMessage>
      <ProviderEditor key={selected} provider={provider} ai={ai} settings={settings} disabled={disabled}
        setBusy={setBusy} onSelect={setSelected} />
    </div>
  </SectionCard>
}

function ProviderEditor({ provider, ai, settings, disabled, setBusy, onSelect }: {
  provider?: AIProvider; ai: AISettings; settings: Settings; disabled: boolean; setBusy(value: boolean): void; onSelect(id: string): void
}) {
  const { t } = useTranslation(), { data } = useServices()
  const [confirm, setConfirm] = useState<'key' | 'provider' | null>(null), [removeError, setRemoveError] = useState(false)
  const connection = useAIConnection(provider, ai.default, value => {
    settings.updateAI(value)
    onSelect(value.ai.default!.providerId)
  })
  const { setAIDirty } = settings
  useEffect(() => { setAIDirty(connection.dirty); return () => setAIDirty(false) }, [connection.dirty, setAIDirty])
  async function remove() {
    if (!provider) return
    setBusy(true); setRemoveError(false)
    try {
      const current = await data.settings.get({})
      if (!current.ok) throw new Error()
      const preferences = current.value.ai, providers = preferences.providers.filter(entry => entry.id !== provider.id)
      const result = await data.settings.savePreferences({ ai: { providers, default: preferences.default?.providerId === provider.id ? null : preferences.default } })
      if (!result.ok) throw new Error()
      settings.updateAI(result.value)
      onSelect(result.value.ai.default?.providerId ?? providers[0]?.id ?? '')
    } catch { setRemoveError(true) }
    finally { setBusy(false) }
  }
  async function act(operation: () => Promise<unknown>) {
    setBusy(true)
    try { await operation() } finally { setBusy(false) }
  }
  return <>
    <AIConnectionEditor connection={connection} disabled={disabled} />
    {removeError && <StatusMessage tone="error">{t($ => $.settings.saveFailed)}</StatusMessage>}
    {connection.saved && <StatusMessage tone="success">{t($ => $.settings.saved)}</StatusMessage>}
    <ActionRow>
      {connection.keyStatus?.configured && <Button disabled={disabled} variant="danger" onClick={() => setConfirm('key')}>{t($ => $.settings.deleteKey)}</Button>}
      {provider && <Button disabled={disabled || connection.keyStatus?.configured !== false} variant="danger" onClick={() => setConfirm('provider')}>{t($ => $.settings.removeProvider)}</Button>}
      <Button data-ai-connect variant="primary" disabled={disabled || !connection.ready || connection.saved} onClick={() => void act(connection.advance)}>
        {connection.hasModels ? t($ => $.settings.save) : t($ => $.onboarding.next)}
      </Button>
    </ActionRow>
    <Dialog open={confirm !== null} title={confirm === 'key' ? t($ => $.settings.deleteTitle) : t($ => $.settings.removeProvider)}
      description={confirm === 'key' ? t($ => $.settings.deleteDescription) : provider?.name} onClose={() => setConfirm(null)}>
      <Button autoFocus onClick={() => setConfirm(null)}>{t($ => $.settings.cancel)}</Button>
      <Button variant="danger" onClick={() => {
        if (confirm === 'key') void act(connection.deleteKey)
        if (confirm === 'provider') void remove()
        setConfirm(null)
      }}>{confirm === 'key' ? t($ => $.settings.deleteKey) : t($ => $.settings.removeProvider)}</Button>
    </Dialog>
  </>
}
