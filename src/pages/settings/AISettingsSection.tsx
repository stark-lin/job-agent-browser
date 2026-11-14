import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AIConnectionEditor } from '../../app/ai/AIConnectionEditor'
import { useServices } from '../../app/providers'
import type { AIError, AISettings } from '../../shared/ai'
import type { Preferences } from '../../shared/settings'
import { ActionRow, Button, Dialog, FormField, SectionCard, Select, StatusMessage } from '../../shared/ui'

const newId = () => `provider-${crypto.randomUUID()}`

export function AISettingsSection({ aiSettings, onSaved, onDirty, disabled }: {
  aiSettings: AISettings; onSaved(value: Preferences): void; onDirty(value: boolean): void; disabled: boolean
}) {
  const { t } = useTranslation(), { ai } = useServices()
  const [selected, setSelected] = useState(() => aiSettings.default?.providerId ?? aiSettings.providers[0]?.id ?? newId())
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false), [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<AIError>()
  const provider = aiSettings.providers.find(item => item.id === selected)
  const locked = busy || disabled || deleting

  function select(id: string) { setError(undefined); setSelected(id) }
  async function remove() {
    if (!provider || locked) return
    setDeleting(true); setError(undefined)
    try {
      const result = await ai.saveConnection({ removeProviderId: provider.id, previousEndpoint: provider.baseURL })
      if (!result.ok) { setError(result.error); return }
      onSaved(result.value)
      select(result.value.ai.default?.providerId ?? result.value.ai.providers[0]?.id ?? newId())
    } catch { setError('STORAGE_UNAVAILABLE') }
    finally { setDeleting(false); setConfirm(false) }
  }

  return <SectionCard defaultCollapsed data-settings-ai title={t($ => $.connection.title)}>
    <div className="settings-ai-layout">
      <div className="settings-stack">
        <FormField label={t($ => $.connection.savedConnection)}>{props =>
          <Select {...props} disabled={locked} value={selected} onChange={event => select(event.target.value)}>
            {aiSettings.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            {!provider && <option value={selected}>{t($ => $.connection.newConnection)}</option>}
          </Select>}</FormField>
        {provider && <ActionRow>
          <Button disabled={locked || aiSettings.providers.length >= 20} onClick={() => select(newId())}>{t($ => $.connection.newConnection)}</Button>
          <Button variant="danger" disabled={locked} onClick={() => setConfirm(true)}>{t($ => $.connection.deleteConnection)}</Button>
        </ActionRow>}
        {error && <StatusMessage tone="error">{t($ => $.ai.errors[error])}</StatusMessage>}
      </div>
      <AIConnectionEditor key={selected} settings={aiSettings} providerId={selected} onBusy={setBusy} onDirty={onDirty}
        onSaved={onSaved} submitLabel={t($ => $.settings.save)} disabled={disabled || deleting} />
    </div>
    <Dialog open={confirm} title={t($ => $.connection.deleteConnection)} description={t($ => $.connection.deleteDescription, { name: provider?.name ?? '' })}
      onClose={() => { if (!deleting) setConfirm(false) }}>
      <Button autoFocus disabled={deleting} onClick={() => setConfirm(false)}>{t($ => $.settings.cancel)}</Button>
      <Button variant="danger" disabled={deleting} onClick={() => void remove()}>{t($ => $.connection.deleteConnection)}</Button>
    </Dialog>
  </SectionCard>
}
