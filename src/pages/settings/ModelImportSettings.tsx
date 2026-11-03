import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AIProvider, ModelCapabilities } from '../../shared/ai'
import { Checkbox, FormField, Select, TextInput } from '../../shared/ui'

export function ModelImportSettings({ provider, disabled, onChange, onCapabilities }: { provider: AIProvider; disabled: boolean; onChange: (models: string[]) => void; onCapabilities(value: Record<string, ModelCapabilities>): void }) {
  const { t } = useTranslation(), [selected, setSelected] = useState(provider.defaultModel)
  const models = provider.models.filter(Boolean), model = models.includes(selected) ? selected : models[0] ?? ''
  const capability = provider.capabilities?.[model]
  function edit(field: 'contextWindow' | 'maxOutputTokens', value: string) {
    const next = { contextWindow: capability?.contextWindow ?? 0, maxOutputTokens: capability?.maxOutputTokens ?? 0, source: 'manual' as const, verified: true, [field]: Number(value) }
    onCapabilities({ ...provider.capabilities, [model]: next })
  }
  return <>
    <FormField label={t($ => $.imports.configureModel)}>{props => <Select {...props} disabled={disabled || !models.length} value={model} onChange={event => setSelected(event.target.value)}>
      {!models.length && <option value="">{t($ => $.settings.none)}</option>}
      {models.map((id, index) => <option key={index} value={id}>{id}</option>)}
    </Select>}</FormField>
    <Checkbox label={t($ => $.imports.allowParallel)} disabled={disabled || !model} checked={Boolean(model && provider.parallelModels?.includes(model))}
      onChange={event => onChange(event.target.checked ? [...(provider.parallelModels ?? []).filter(id => id !== model), model] : (provider.parallelModels ?? []).filter(id => id !== model))} />
    <FormField label={t($ => $.settings.contextWindow)} help={t($ => $.settings.contextWindowHelp)}>{props => <TextInput {...props} type="number" min={1} max={100000000} disabled={disabled || !model} value={capability?.contextWindow ?? ''} onChange={event => edit('contextWindow', event.target.value)} />}</FormField>
    <FormField label={t($ => $.settings.maxOutputTokens)}>{props => <TextInput {...props} type="number" min={1} max={capability?.contextWindow ?? 100000000} disabled={disabled || !model} value={capability?.maxOutputTokens ?? ''} onChange={event => edit('maxOutputTokens', event.target.value)} />}</FormField>
  </>
}
