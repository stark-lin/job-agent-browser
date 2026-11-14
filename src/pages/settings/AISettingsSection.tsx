import { Button, Dialog, DialogHeader, Heading, Section, Selector, Stack, Text } from '@astryxdesign/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AIConnectionEditor } from '../../app/ai/AIConnectionEditor'
import { useServices } from '../../app/providers'
import type { AIError, AISettings } from '../../shared/ai'
import type { Preferences } from '../../shared/settings'


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

  return <Section className="feature-section" padding={0}><details data-settings-ai  onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.connection.title)}</Heading></summary>
      <div className="feature-section-body">
    <div className="settings-ai-layout">
      <div className="settings-stack">
        <Selector label={t($ => $.connection.savedConnection)} isDisabled={locked} value={selected} onChange={event => select(event)}  options={[...(aiSettings.providers.map(item => ({ value: item.id, label: item.name }))), ...(!provider  ? [({ value: selected, label: t($ => $.connection.newConnection) })] : [])]} />
        {provider && <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
          <Button isDisabled={locked || aiSettings.providers.length >= 20} onClick={() => select(newId())} label={t($ => $.connection.newConnection)} />
          <Button variant="destructive" isDisabled={locked} onClick={() => setConfirm(true)} label={t($ => $.connection.deleteConnection)} />
        </Stack>}
        {error && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.ai.errors[error])}</Text>}
      </div>
      <AIConnectionEditor key={selected} settings={aiSettings} providerId={selected} onBusy={setBusy} onDirty={onDirty}
        onSaved={onSaved} submitLabel={t($ => $.settings.save)} disabled={disabled || deleting} />
    </div>
    <Dialog  isOpen={confirm} onOpenChange={() => { if (!deleting) setConfirm(false) }} aria-label={t($ => $.connection.deleteConnection)} width={448} purpose="form">
      <DialogHeader title={t($ => $.connection.deleteConnection)} subtitle={t($ => $.connection.deleteDescription, { name: provider?.name ?? '' })} />
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
      <Button data-autofocus="true" isDisabled={deleting} onClick={() => setConfirm(false)} label={t($ => $.settings.cancel)} />
      <Button variant="destructive" isDisabled={deleting} onClick={() => void remove()} label={t($ => $.connection.deleteConnection)} />
    </Stack>
    </Dialog>
  </div></details></Section>
}
