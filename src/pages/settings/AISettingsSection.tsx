import { Button, Dialog, DialogHeader, FormLayout, Heading, Section, Selector, Stack } from '@astryxdesign/core'
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
  const options = aiSettings.providers.map(item => ({ value: item.id, label: item.name }))
  if (!provider) options.push({ value: selected, label: t($ => $.settings.newProvider) })

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

  return <Section variant="transparent" padding={0} data-settings-ai>
    <Stack gap={4}>
      <Heading level={2}>{t($ => $.settings.aiTitle)}</Heading>
      <FormLayout>
        <Stack className="settings-provider-row" direction="horizontal" align="end" gap={2} wrap="wrap">
          <Selector label={t($ => $.settings.provider)} isDisabled={locked} value={selected} onChange={select} options={options}
            status={error ? { type: 'error', message: t($ => $.ai.errors[error]) } : undefined} />
          <Button isDisabled={locked || !provider || aiSettings.providers.length >= 20} onClick={() => select(newId())}
            label={t($ => $.settings.new)} aria-label={t($ => $.settings.newProvider)} />
        </Stack>
      </FormLayout>
      <AIConnectionEditor key={selected} settings={aiSettings} providerId={selected} onBusy={setBusy} onDirty={onDirty}
        onSaved={onSaved} submitLabel={t($ => $.settings.save)} disabled={disabled || deleting}
        secondaryAction={provider && <Button variant="destructive" isDisabled={locked} onClick={() => setConfirm(true)}
          label={t($ => $.settings.deleteProvider)} />} />
    </Stack>
    <Dialog isOpen={confirm} onOpenChange={() => { if (!deleting) setConfirm(false) }} width={448} purpose="form">
      <DialogHeader title={t($ => $.settings.deleteProvider)} subtitle={t($ => $.connection.deleteDescription, { name: provider?.name ?? '' })} />
      <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
        <Button data-autofocus="true" isDisabled={deleting} onClick={() => setConfirm(false)} label={t($ => $.settings.cancel)} />
        <Button variant="destructive" isDisabled={deleting} onClick={() => void remove()} label={t($ => $.settings.deleteProvider)} />
      </Stack>
    </Dialog>
  </Section>
}
