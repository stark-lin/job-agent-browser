import { Button, Collapsible, FormLayout, Heading, NumberInput, Selector, Stack, Text, TextInput } from '@astryxdesign/core'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AI_DEFAULTS, type AISettings, type ModelOverrides, type AITimeoutOverrides } from '../../shared/ai'
import type { Preferences } from '../../shared/settings'
import { useAIConnection, timeoutDefaults } from './useAIConnection'
import './ai-connection.css'

export function AIConnectionEditor({ settings, providerId, onSaved, onBusy, onDirty, submitLabel, disabled, secondaryAction }: {
  settings: AISettings; providerId: string; onSaved(value: Preferences): void
  onBusy?(value: boolean): void; onDirty?(value: boolean): void
  submitLabel: string; disabled?: boolean; secondaryAction?: ReactNode
}) {
  const { t } = useTranslation()
  const connection = useAIConnection(settings, providerId, onSaved)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const { busy, dirty, notice } = connection
  useEffect(() => { onBusy?.(busy) }, [busy, onBusy])
  useEffect(() => { onDirty?.(dirty) }, [dirty, onDirty])
  useEffect(() => {
    if (notice === 'invalidModel' || notice === 'invalidLimits') setAdvancedOpen(true)
  }, [notice])

  const locked = Boolean(disabled || busy)
  const modelOptions = [
    { value: '', label: t($ => connection.models.length ? $.connection.chooseModel : $.connection.discoverAutomatically) },
    ...connection.models.map(id => ({ value: id, label: id }))
  ]
  const limitFields = [
    ['contextWindow', AI_DEFAULTS.contextWindow],
    ['maxOutputTokens', AI_DEFAULTS.maxOutputTokens]
  ] as const satisfies readonly [keyof ModelOverrides, number][]
  const error = notice === 'invalidEndpoint' || notice === 'invalidModel' || notice === 'invalidLimits'
    ? t($ => $.connection[notice]) : notice === 'AI_PROTOCOL_ERROR' ? t($ => $.connection.invalidDiscovery)
      : notice && notice !== 'saved' ? t($ => $.ai.errors[notice]) : ''

  return <form className="ai-connection" data-ai-connection noValidate onSubmit={event => {
    event.preventDefault()
    if (locked) return
    if (notice === 'invalidModel' || notice === 'invalidLimits') setAdvancedOpen(true)
    void connection.submit()
  }}>
    <FormLayout>
      <TextInput label={t($ => $.connection.endpoint)}
        status={notice === 'invalidEndpoint' ? { type: 'error', message: error } : undefined}
        type="url" ref={input => { if (input) input.maxLength = 2048 }} isDisabled={locked}
        value={connection.endpoint} onChange={connection.editEndpoint} />
      <TextInput label={t($ => $.connection.apiKey)}
        description={connection.replacingEndpoint ? t($ => $.connection.endpointKeyChange) : undefined}
        type="password" ref={input => { if (input) input.maxLength = 4096 }} autoComplete="off" hasSpellCheck={false}
        isDisabled={locked} value={connection.key} onChange={connection.editKey}
        placeholder={t($ => connection.keyConfigured && !connection.clearKey ? $.connection.keepKey : $.connection.optional)} />
      <Selector label={t($ => $.connection.model)}
        status={connection.needsModel ? { type: 'error', message: t($ => $.connection.chooseModel) } : undefined}
        isDisabled={locked || !connection.models.length} value={connection.model} onChange={connection.selectModel} options={modelOptions} />
      <Collapsible trigger={t($ => $.connection.advanced)} isOpen={advancedOpen} onOpenChange={setAdvancedOpen} chevronPosition="start"
        data-ai-advanced>
        <FormLayout className="ai-connection-advanced">
          <TextInput label={t($ => $.connection.name)} ref={input => { if (input) input.maxLength = 100 }}
            isDisabled={locked} value={connection.name} placeholder={connection.generatedName} onChange={connection.editName} />
          <Selector label={t($ => $.connection.preset)} isDisabled={locked} value={connection.preset}
            onChange={value => { if (value === 'auto' || value === 'openai' || value === 'local' || value === 'custom') connection.editPreset(value) }}
            options={[
              { value: 'auto', label: t($ => $.connection.auto) },
              { value: 'openai', label: 'OpenAI' },
              { value: 'local', label: t($ => $.connection.local) },
              { value: 'custom', label: t($ => $.connection.custom) }
            ]} />
          <Selector label={t($ => $.connection.authentication)} isDisabled={locked} value={connection.auth ?? ''}
            onChange={value => { if (value === '' || value === 'none' || value === 'bearer') connection.editAuth(value || undefined) }}
            options={[
              { value: '', label: t($ => $.connection.auto) },
              { value: 'none', label: t($ => $.connection.none) },
              { value: 'bearer', label: 'Bearer' }
            ]} />
          <Stack className="ai-connection-actions" direction="horizontal" align="end" gap={2} wrap="wrap">
            <TextInput label={t($ => $.connection.manualId)}
              status={notice === 'invalidModel' ? { type: 'error', message: error } : undefined}
              isDisabled={locked} ref={input => { if (input) input.maxLength = 200 }}
              value={connection.manualId} onChange={connection.editManualId} />
            <Button isDisabled={locked || !connection.manualId.trim()} onClick={connection.addModel} label={t($ => $.connection.addModel)} />
          </Stack>
          <Stack className="ai-connection-actions" direction="horizontal" align="end" gap={2} wrap="wrap">
            <Selector label={t($ => $.connection.modelList)} isDisabled={locked || !connection.models.length}
              value={connection.model} onChange={connection.selectModel} options={modelOptions} />
            <Button isDisabled={locked || !connection.model} onClick={connection.removeModel} label={t($ => $.connection.removeModel)} />
          </Stack>
          {limitFields.map(([field, fallback]) => <NumberInput label={t($ => $.connection[field])} key={field} hasClear isIntegerOnly
            isDisabled={locked || !connection.model} placeholder={t($ => $.connection.fallback, { count: fallback })}
            value={connection.override?.[field]} onChange={value => connection.editOverride(field, value ?? undefined)} />)}
          <Heading level={3}>{t($ => $.connection.timeoutOverrides)}</Heading>
          {(Object.keys(timeoutDefaults) as (keyof AITimeoutOverrides)[]).map(field => <NumberInput label={t($ => $.connection[field])}
            key={field} hasClear isIntegerOnly isDisabled={locked} placeholder={t($ => $.connection.seconds, { count: timeoutDefaults[field] })}
            value={connection.timeouts[field]} onChange={value => connection.editTimeout(field, value ?? undefined)} />)}
          <Stack direction="horizontal" gap={2} wrap="wrap">
            <Button isDisabled={locked} onClick={connection.restoreDefaults} label={t($ => $.connection.restoreDefaults)} />
            {connection.keyConfigured && <Button isDisabled={locked} variant={connection.clearKey ? 'ghost' : 'destructive'}
              onClick={() => connection.removeKey(!connection.clearKey)}
              label={t($ => connection.clearKey ? $.connection.undoKeyRemoval : $.connection.removeKey)} />}
          </Stack>
        </FormLayout>
      </Collapsible>
      <Stack direction="horizontal" align="center" gap={2} wrap="wrap">
        <Button type="submit" variant="primary" isDisabled={locked} data-ai-submit label={busy ? t($ => $.connection.connecting) : submitLabel} />
        {secondaryAction}
        {notice === 'saved' && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.settings.saved)}</Text>}
        {error && notice !== 'invalidEndpoint' && (notice !== 'invalidModel' || !advancedOpen) &&
          <Text as="p" type="supporting" role="alert" className="error-message">{error}</Text>}
      </Stack>
    </FormLayout>
  </form>
}
