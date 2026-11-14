import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AI_DEFAULTS, type AISettings, type AuthenticationOverride, type ModelOverrides, type AITimeoutOverrides } from '../../shared/ai'
import type { Preferences } from '../../shared/settings'
import { ActionRow, Button, FormField, SectionCard, Select, StatusMessage, TextInput, QuietPanel } from '../../shared/ui'
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
  const modelOptions = <>
    <option value="">{t($ => connection.models.length ? $.connection.chooseModel : $.connection.discoverAutomatically)}</option>
    {connection.models.map(id => <option key={id} value={id}>{id}</option>)}
  </>
  const limitFields = [
    ['contextWindow', AI_DEFAULTS.contextWindow],
    ['maxOutputTokens', AI_DEFAULTS.maxOutputTokens]
  ] as const satisfies readonly [keyof ModelOverrides, number][]
  const error = notice === 'invalidEndpoint' || notice === 'invalidModel' || notice === 'invalidLimits'
    ? t($ => $.connection[notice]) : notice === 'AI_PROTOCOL_ERROR' ? t($ => $.connection.invalidDiscovery)
      : notice && notice !== 'saved' ? t($ => $.ai.errors[notice]) : ''

  return <form className="ai-connection" data-ai-connection noValidate onSubmit={event => { event.preventDefault(); if (!locked) void connection.submit() }}>
    <FormField label={t($ => $.connection.endpoint)} error={notice === 'invalidEndpoint' ? error : undefined}>{props =>
      <TextInput {...props} type="url" maxLength={2048} disabled={locked} value={connection.endpoint} onChange={e => connection.editEndpoint(e.target.value)} />}</FormField>
    <FormField label={t($ => $.connection.apiKey)} help={connection.replacingEndpoint ? t($ => $.connection.endpointKeyChange) : undefined}>{props =>
      <TextInput {...props} type="password" maxLength={4096} autoComplete="off" spellCheck={false} disabled={locked} value={connection.key}
        placeholder={t($ => connection.keyConfigured && !connection.clearKey ? $.connection.keepKey : $.connection.optional)}
        onChange={e => connection.editKey(e.target.value)} />}</FormField>
    <FormField label={t($ => $.connection.model)} error={connection.needsModel ? t($ => $.connection.chooseModel) : undefined}>{props =>
      <Select {...props} disabled={locked || !connection.models.length} value={connection.model} onChange={e => connection.selectModel(e.target.value)}>{modelOptions}</Select>}</FormField>
    <SectionCard title={t($ => $.connection.advanced)} defaultCollapsed data-ai-advanced>
      <div className="ai-connection">
        <FormField label={t($ => $.connection.name)}>{props =>
          <TextInput {...props} maxLength={100} disabled={locked} value={connection.name} placeholder={connection.generatedName}
            onChange={e => connection.editName(e.target.value)} />}</FormField>
        <FormField label={t($ => $.connection.preset)}>{props =>
          <Select {...props} disabled={locked} value={connection.preset} onChange={e => connection.editPreset(e.target.value as typeof connection.preset)}>
            <option value="auto">{t($ => $.connection.auto)}</option><option value="openai">OpenAI</option>
            <option value="local">{t($ => $.connection.local)}</option><option value="custom">{t($ => $.connection.custom)}</option>
          </Select>}</FormField>
        <FormField label={t($ => $.connection.authentication)}>{props =>
          <Select {...props} disabled={locked} value={connection.auth ?? ''} onChange={e => connection.editAuth(e.target.value as AuthenticationOverride || undefined)}>
            <option value="">{t($ => $.connection.auto)}</option><option value="none">{t($ => $.connection.none)}</option><option value="bearer">Bearer</option>
          </Select>}</FormField>
        {connection.keyConfigured && <ActionRow><Button disabled={locked} variant={connection.clearKey ? 'ghost' : 'danger'} onClick={() => connection.removeKey(!connection.clearKey)}>
          {t($ => connection.clearKey ? $.connection.undoKeyRemoval : $.connection.removeKey)}
        </Button></ActionRow>}
        <FormField label={t($ => $.connection.manualId)} error={notice === 'invalidModel' ? error : undefined}>{props =>
          <div className="ai-connection-actions"><TextInput {...props} disabled={locked} maxLength={200} placeholder={t($ => $.connection.optional)} value={connection.manualId}
            onChange={e => connection.editManualId(e.target.value)} />
            <Button disabled={locked || !connection.manualId.trim()} onClick={connection.addModel}>{t($ => $.connection.addModel)}</Button></div>}</FormField>
        <FormField label={t($ => $.connection.modelList)}>{props =>
          <QuietPanel className="ai-connection-actions"><Select {...props} disabled={locked || !connection.models.length} value={connection.model}
            onChange={e => connection.selectModel(e.target.value)}>{modelOptions}</Select>
            <Button disabled={locked || !connection.model} onClick={connection.removeModel}>{t($ => $.connection.removeModel)}</Button></QuietPanel>}</FormField>
        {limitFields.map(([field, fallback]) => <FormField key={field} label={t($ => $.connection[field])}>{props =>
          <TextInput {...props} type="number" min={1} max={100_000_000} disabled={locked || !connection.model}
            placeholder={t($ => $.connection.fallback, { count: fallback })}
            value={connection.override?.[field] ?? ''} onChange={e => connection.editOverride(field, e.target.value === '' ? undefined : Number(e.target.value))} />}</FormField>)}
        {(Object.keys(timeoutDefaults) as (keyof AITimeoutOverrides)[]).map(field => <FormField key={field} label={t($ => $.connection[field])}>{props =>
          <TextInput {...props} type="number" min={1} max={3600} disabled={locked} placeholder={t($ => $.connection.seconds, { count: timeoutDefaults[field] })}
            value={connection.timeouts[field] ?? ''} onChange={e => connection.editTimeout(field, e.target.value === '' ? undefined : Number(e.target.value))} />}</FormField>)}
        <ActionRow><Button disabled={locked} onClick={connection.restoreDefaults}>{t($ => $.connection.restoreDefaults)}</Button></ActionRow>
      </div>
    </SectionCard>
    <ActionRow>
      {notice === 'saved' && <StatusMessage tone="success">{t($ => $.settings.saved)}</StatusMessage>}
      {error && notice !== 'invalidEndpoint' && <StatusMessage tone="error">{error}</StatusMessage>}
      <Button type="submit" variant="primary" disabled={locked} data-ai-submit>{busy ? t($ => $.connection.connecting) : submitLabel}</Button>
    </ActionRow>
  </form>
}
