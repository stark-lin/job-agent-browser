import { Button, Heading, NumberInput, Section, Selector, Stack, Text, TextInput } from '@astryxdesign/core'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AI_DEFAULTS, type AISettings, type ModelOverrides, type AITimeoutOverrides } from '../../shared/ai'
import type { Preferences } from '../../shared/settings'
import { useAIConnection, timeoutDefaults } from './useAIConnection'
import './ai-connection.css'

export function AIConnectionEditor({ settings, providerId, onSaved, onBusy, onDirty, submitLabel, disabled }: {
  settings: AISettings; providerId: string; onSaved(value: Preferences): void
  onBusy?(value: boolean): void; onDirty?(value: boolean): void
  submitLabel: string; disabled?: boolean
}) {
  const { t } = useTranslation()
  const connection = useAIConnection(settings, providerId, onSaved)
  const { busy, dirty, notice } = connection
  useEffect(() => { onBusy?.(busy) }, [busy, onBusy])
  useEffect(() => { onDirty?.(dirty) }, [dirty, onDirty])
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

  return <form className="ai-connection" data-ai-connection noValidate onSubmit={event => { event.preventDefault(); if (!locked) void connection.submit() }}>
    <TextInput label={t($ => $.connection.endpoint)} status={(notice === 'invalidEndpoint' ? error : undefined) ? { type: 'error', message: notice === 'invalidEndpoint' ? error : undefined } : undefined} type="url" ref={input => { if (input) { input.maxLength = 2048 } }} isDisabled={locked} value={connection.endpoint} onChange={e => connection.editEndpoint(e)} />
    <TextInput label={t($ => $.connection.apiKey)} description={connection.replacingEndpoint ? t($ => $.connection.endpointKeyChange) : undefined} type="password" ref={input => { if (input) { input.maxLength = 4096 } }} autoComplete="off" hasSpellCheck={false} isDisabled={locked} value={connection.key}
        placeholder={t($ => connection.keyConfigured && !connection.clearKey ? $.connection.keepKey : $.connection.optional)}
        onChange={e => connection.editKey(e)} />
    <Selector label={t($ => $.connection.model)} status={(connection.needsModel ? t($ => $.connection.chooseModel) : undefined) ? { type: 'error', message: connection.needsModel ? t($ => $.connection.chooseModel) : undefined } : undefined} isDisabled={locked || !connection.models.length} value={connection.model} onChange={e => connection.selectModel(e)}  options={[...modelOptions]} />
    <Section className="feature-section" padding={0}><details data-ai-advanced  onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.connection.advanced)}</Heading></summary>
      <div className="feature-section-body">
      <div className="ai-connection">
        <TextInput label={t($ => $.connection.name)} ref={input => { if (input) { input.maxLength = 100 } }} isDisabled={locked} value={connection.name} placeholder={connection.generatedName}
            onChange={e => connection.editName(e)} />
        <Selector label={t($ => $.connection.preset)} isDisabled={locked} value={connection.preset} onChange={e => { if (e === 'auto' || e === 'openai' || e === 'local' || e === 'custom') connection.editPreset(e) }}  options={[({ value: "auto", label: t($ => $.connection.auto) }), ({ value: "openai", label: "OpenAI" }), ({ value: "local", label: t($ => $.connection.local) }), ({ value: "custom", label: t($ => $.connection.custom) })]} />
        <Selector label={t($ => $.connection.authentication)} isDisabled={locked} value={connection.auth ?? ''} onChange={e => { if (e === '' || e === 'none' || e === 'bearer') connection.editAuth(e || undefined) }}  options={[({ value: "", label: t($ => $.connection.auto) }), ({ value: "none", label: t($ => $.connection.none) }), ({ value: "bearer", label: "Bearer" })]} />
        {connection.keyConfigured && <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button isDisabled={locked} variant={connection.clearKey ? 'ghost' : 'destructive'} onClick={() => connection.removeKey(!connection.clearKey)} label={t($ => connection.clearKey ? $.connection.undoKeyRemoval : $.connection.removeKey)} /></Stack>}
        <div className="ai-connection-actions"><TextInput label={t($ => $.connection.manualId)} status={(notice === 'invalidModel' ? error : undefined) ? { type: 'error', message: notice === 'invalidModel' ? error : undefined } : undefined} isDisabled={locked} ref={input => { if (input) { input.maxLength = 200 } }} placeholder={t($ => $.connection.optional)} value={connection.manualId}
            onChange={e => connection.editManualId(e)} />
            <Button isDisabled={locked || !connection.manualId.trim()} onClick={connection.addModel} label={t($ => $.connection.addModel)} /></div>
        <Section className="ai-connection-actions" variant="muted" padding={3}><Selector label={t($ => $.connection.modelList)} isDisabled={locked || !connection.models.length} value={connection.model} onChange={e => connection.selectModel(e)}  options={[...modelOptions]} />
            <Button isDisabled={locked || !connection.model} onClick={connection.removeModel} label={t($ => $.connection.removeModel)} /></Section>
        {limitFields.map(([field, fallback]) => <NumberInput label={t($ => $.connection[field])} key={field} hasClear isIntegerOnly isDisabled={locked || !connection.model}
            placeholder={t($ => $.connection.fallback, { count: fallback })}
            value={connection.override?.[field]} onChange={value => connection.editOverride(field, value ?? undefined)} />)}
        {(Object.keys(timeoutDefaults) as (keyof AITimeoutOverrides)[]).map(field => <NumberInput label={t($ => $.connection[field])} key={field} hasClear isIntegerOnly isDisabled={locked} placeholder={t($ => $.connection.seconds, { count: timeoutDefaults[field] })}
            value={connection.timeouts[field]} onChange={value => connection.editTimeout(field, value ?? undefined)} />)}
        <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button isDisabled={locked} onClick={connection.restoreDefaults} label={t($ => $.connection.restoreDefaults)} /></Stack>
      </div>
    </div></details></Section>
    <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
      {notice === 'saved' && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.settings.saved)}</Text>}
      {error && notice !== 'invalidEndpoint' && <Text as="p" type="supporting" role="alert" className="error-message">{error}</Text>}
      <Button type="submit" variant="primary" isDisabled={locked} data-ai-submit label={busy ? t($ => $.connection.connecting) : submitLabel} />
    </Stack>
  </form>
}
