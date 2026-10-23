import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, FormField, SectionCard, Select, StatusMessage, TextArea, TextInput } from '../../shared/ui'
import type { useSettings, Notice } from './useSettings'
import { useAIRequest } from '../../app/ai/useAIRequest'
import { defaultAITimeouts, type AIError } from '../../shared/ai'
import { ModelDiscovery } from './ModelDiscovery'
import { ModelImportSettings } from './ModelImportSettings'
import { TimeoutSettings } from './TimeoutSettings'

export function AISettingsSection({ settings: s }: { settings: ReturnType<typeof useSettings> }) {
  const { t } = useTranslation(), [confirmDelete, setConfirmDelete] = useState(false)
  const client = useAIRequest(), mounted = useRef(true)
  const [probe, setProbe] = useState<'idle' | 'pending' | 'success'>('idle'), [probeError, setProbeError] = useState<AIError | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const { draft, provider: p, saving, notices, keyStatus } = s
  if (!draft) return null
  const busy = Boolean(saving) || probe === 'pending'
  const feedback = (notice: Notice) => notice && <StatusMessage tone={['saved', 'keySaved', 'keyDeleted'].includes(notice) ? 'success' : 'error'}>{t($ => $.settings[notice])}</StatusMessage>
  async function testConnection() {
    if (!p?.defaultModel || !client.current || busy) return
    setProbe('pending'); setProbeError(null)
    const result = await client.current.start({ choice: { providerId: p.id, modelId: p.defaultModel }, messages: [{ role: 'user', content: 'Reply with OK.' }] }, event => {
      if (!mounted.current) return
      if (event.type === 'completed') setProbe('success')
      if (event.type === 'failed' || event.type === 'cancelled') { setProbe('idle'); setProbeError(event.type === 'failed' ? event.error : 'AI_CANCELLED') }
    })
    if (!result.ok && mounted.current) { setProbe('idle'); setProbeError(result.error) }
  }
  return <SectionCard title={t($ => $.settings.ai)} description={t($ => $.settings.aiDescription)}>
    <div className="settings-stack">
      <form className="settings-stack" data-ai-config onSubmit={event => { event.preventDefault(); void s.save('ai') }}>
        <TimeoutSettings value={draft.ai.timeouts ?? defaultAITimeouts} disabled={busy} onChange={timeouts => s.changeAI({ ...draft.ai, timeouts })} />
        <FormField label={t($ => $.settings.provider)}>{props => <Select {...props} disabled={busy || Boolean(s.key)} value={s.selectedProvider} onChange={event => { setProbe('idle'); setProbeError(null); s.setSelectedProvider(event.target.value) }}>
          {!draft.ai.providers.length && <option value="">{t($ => $.settings.none)}</option>}
          {draft.ai.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name || t($ => $.settings.newProvider)}</option>)}
        </Select>}</FormField>
        <div className="settings-buttons">
          <Button disabled={busy || Boolean(s.key) || draft.ai.providers.length >= 20} onClick={s.addProvider}>{t($ => $.settings.addProvider)}</Button>
          <Button variant="danger" disabled={busy || Boolean(s.key) || !p || keyStatus.configured || (!s.keyReady && s.providerSaved)} onClick={s.removeProvider}>{t($ => $.settings.removeProvider)}</Button>
        </div>
        {p && <>
          <FormField label={t($ => $.settings.providerName)}>{props => <TextInput {...props} required maxLength={100} disabled={busy} value={p.name} onChange={event => s.editProvider({ name: event.target.value })} />}</FormField>
          <FormField label={t($ => $.settings.baseURL)} help={t($ => $.settings.baseURLHelp)}>{props => <TextInput {...props} type="url" required disabled={busy} maxLength={2048} placeholder="http://127.0.0.1:1234" value={p.baseURL} onChange={event => s.editProvider({ baseURL: event.target.value })} />}</FormField>
          <FormField label={t($ => $.settings.authentication)}>{props => <Select {...props} disabled={busy} value={String(p.requiresKey)} onChange={event => s.editProvider({ requiresKey: event.target.value === 'true' })}>
            <option value="true">{t($ => $.settings.keyRequired)}</option><option value="false">{t($ => $.settings.noKey)}</option>
          </Select>}</FormField>
          <ModelDiscovery key={`${p.id}:${p.baseURL}:${p.requiresKey}:${keyStatus.configured}`} settings={s} busy={busy} />
          <FormField label={t($ => $.settings.models)} help={t($ => $.settings.modelsHelp)}>{props => <TextArea {...props} disabled={busy} value={p.models.join('\n')} onChange={event => s.editProvider({ models: event.target.value.split('\n') })} />}</FormField>
          <FormField label={t($ => $.settings.defaultModel)}>{props => <Select {...props} disabled={busy} value={p.defaultModel} onChange={event => s.editProvider({ defaultModel: event.target.value })}>
            <option value="">{t($ => $.settings.none)}</option>{p.models.filter(Boolean).map((model, index) => <option key={index} value={model}>{model}</option>)}
          </Select>}</FormField>
          <ModelImportSettings key={p.id} provider={p} disabled={busy} onChange={parallelModels => s.editProvider({ parallelModels })} />
          <Button disabled={busy || !p.defaultModel} onClick={() => s.changeAI({ ...draft.ai, default: { providerId: p.id, modelId: p.defaultModel } })}>{t($ => $.settings.makeDefault)}</Button>
          <StatusMessage>{draft.ai.default ? t($ => $.settings.currentDefault, { provider: draft.ai.providers.find(provider => provider.id === draft.ai.default?.providerId)?.name ?? '', model: draft.ai.default.modelId }) : t($ => $.settings.noDefault)}</StatusMessage>
        </>}
        <StatusMessage>{t($ => $.settings.removeKeyFirst)}</StatusMessage>
        {feedback(notices.ai)}
        <div className="settings-actions"><Button type="submit" variant="primary" disabled={busy || !s.aiDirty}>{t($ => $.settings.save)}</Button></div>
      </form>
      {p && <form className="settings-stack" data-ai-key onSubmit={event => { event.preventDefault(); void s.saveKey() }}>
        <StatusMessage tone={keyStatus.configured ? 'success' : 'neutral'}>{keyStatus.configured ? t($ => $.settings.configured) : t($ => $.settings.notConfigured)}</StatusMessage>
        <FormField label={t($ => $.settings.apiKey)} help={t($ => $.settings.keyHelp)}>{props => <TextInput {...props} type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={s.key} placeholder={t($ => $.settings.keyPlaceholder)} disabled={busy || !s.providerSaved || !keyStatus.available} onChange={event => s.changeKey(event.target.value)} />}</FormField>
        {!s.providerSaved && <StatusMessage>{t($ => $.settings.saveProviderFirst)}</StatusMessage>}
        {s.keyReady && !keyStatus.available && <StatusMessage tone="error">{t($ => $.settings.encryptionUnavailable)}</StatusMessage>}
        {s.keyLoadFailed && <><StatusMessage tone="error">{t($ => $.settings.loadFailed)}</StatusMessage><Button onClick={s.retryKey}>{t($ => $.settings.retry)}</Button></>}
        {feedback(notices.key)}
        <div className="settings-buttons">
          {keyStatus.configured && <Button variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>{t($ => $.settings.deleteKey)}</Button>}
          <Button variant="primary" type="submit" disabled={!s.key.trim() || /\s/.test(s.key.trim()) || busy || !s.providerSaved || !keyStatus.available}>{keyStatus.configured ? t($ => $.settings.replaceKey) : t($ => $.settings.saveKey)}</Button>
        </div>
      </form>}
      <StatusMessage>{t($ => $.settings.testHelp)}</StatusMessage>
      <Button disabled={busy || s.aiDirty || Boolean(s.key) || !s.providerSaved || !p?.defaultModel} onClick={() => void testConnection()}>{probe === 'pending' ? t($ => $.settings.testing) : t($ => $.settings.testConnection)}</Button>
      {probe === 'success' && <StatusMessage tone="success">{t($ => $.settings.connectionOK)}</StatusMessage>}
      {probeError && <StatusMessage tone="error">{t($ => $.ai.errors[probeError!])}</StatusMessage>}
    </div>
    <Dialog open={confirmDelete} title={t($ => $.settings.deleteTitle)} description={t($ => $.settings.deleteDescription)} onClose={() => setConfirmDelete(false)}>
      <Button autoFocus onClick={() => setConfirmDelete(false)}>{t($ => $.settings.cancel)}</Button>
      <Button variant="danger" onClick={() => { setConfirmDelete(false); void s.saveKey(true) }}>{t($ => $.settings.deleteKey)}</Button>
    </Dialog>
  </SectionCard>
}
