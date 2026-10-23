import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AIProvider } from '../../shared/ai'
import { Checkbox, FormField, Select } from '../../shared/ui'

export function ModelImportSettings({ provider, disabled, onChange }: { provider: AIProvider; disabled: boolean; onChange: (models: string[]) => void }) {
  const { t } = useTranslation(), [selected, setSelected] = useState(provider.defaultModel)
  const models = provider.models.filter(Boolean), model = models.includes(selected) ? selected : models[0] ?? ''
  return <>
    <FormField label={t($ => $.imports.configureModel)}>{props => <Select {...props} disabled={disabled || !models.length} value={model} onChange={event => setSelected(event.target.value)}>
      {!models.length && <option value="">{t($ => $.settings.none)}</option>}
      {models.map((id, index) => <option key={index} value={id}>{id}</option>)}
    </Select>}</FormField>
    <Checkbox label={t($ => $.imports.allowParallel)} disabled={disabled || !model} checked={Boolean(model && provider.parallelModels?.includes(model))}
      onChange={event => onChange(event.target.checked ? [...(provider.parallelModels ?? []).filter(id => id !== model), model] : (provider.parallelModels ?? []).filter(id => id !== model))} />
  </>
}
