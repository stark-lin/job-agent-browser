import { useTranslation } from 'react-i18next'
import { Checkbox, FormField, QuietPanel, Radio, Select, StatusMessage, TextInput } from '../../shared/ui'
import './ai-connection.css'
import type { useAIConnection } from './useAIConnection'

export function AIConnectionEditor({ connection: c, disabled }: { connection: ReturnType<typeof useAIConnection>; disabled: boolean }) {
  const { t } = useTranslation()
  return <>
    <FormField label={t($ => $.onboarding.provider)}>{props => <Select {...props} disabled={disabled} value={c.kind} onChange={e => c.changeProvider(e.target.value as typeof c.kind)}>
      <option value="openai">{t($ => $.onboarding.openai)}</option>
      <option value="local">{t($ => $.onboarding.local)}</option>
      <option value="custom">{t($ => $.onboarding.custom)}</option>
    </Select>}</FormField>
    <FormField label="Endpoint">{props => <TextInput {...props} type="url" maxLength={2048} disabled={disabled} value={c.endpoint} onChange={e => c.editEndpoint(e.target.value)} />}</FormField>
    <FormField label={t($ => $.settings.apiKey)}>{props => <TextInput {...props} type="password" maxLength={4096} autoComplete="off" spellCheck={false} disabled={disabled}
      value={c.key} placeholder={c.canReuseKey && c.keyStatus?.configured ? t($ => $.settings.configured) : t($ => $.onboarding.keyPlaceholder)} onChange={e => c.editKey(e.target.value)} />}</FormField>
    {c.keyStatus?.configured && !c.canReuseKey && !c.key.trim() && <StatusMessage>{t($ => $.settings.keyForNewEndpoint)}</StatusMessage>}
    {c.hasModels && <div className="ai-connection-results">
      <div className="ai-connection-row"><span>{t($ => $.onboarding.foundModels, { count: c.discovered.length })}</span><span>{t($ => $.onboarding.defaultLabel)}</span></div>
      {c.discovered.map(id => <QuietPanel key={id} className="ai-connection-row">
        <Checkbox label={id} checked={c.selected.includes(id)} disabled={disabled || c.discovered.length === 1 || (!c.selected.includes(id) && c.selected.length >= 100)} onChange={event => c.toggle(id, event.target.checked)} />
        <Radio label={c.model === id ? t($ => $.onboarding.defaultLabel) : ''} aria-label={`${t($ => $.onboarding.defaultLabel)} ${id}`} name="ai-connection-default" checked={c.model === id}
          disabled={disabled || (!c.selected.includes(id) && c.selected.length >= 100)} onChange={() => c.chooseDefault(id)} />
      </QuietPanel>)}
    </div>}
    {c.error && <StatusMessage tone="error">{c.error}</StatusMessage>}
  </>
}
