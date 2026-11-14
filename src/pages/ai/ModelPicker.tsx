import { useTranslation } from 'react-i18next'
import { Select } from '../../shared/ui'
import type { AIChoice, AISettings } from '../../shared/ai'
export function ModelPicker({ config, choice, busy, onChange }: { config: AISettings | null; choice: AIChoice | null; busy: boolean; onChange(choice: AIChoice): void }) {
  const { t } = useTranslation(), encode = (value: AIChoice) => JSON.stringify([value.providerId, value.modelId])
  const options = config?.providers.flatMap(p => p.models.map(modelId => ({ choice: { providerId: p.id, modelId }, label: `${p.name} · ${modelId}` }))) ?? []
  const valid = options.some(option => choice && encode(option.choice) === encode(choice))
  return <Select aria-label={t($ => $.ask.model)} value={choice ? encode(choice) : ''} disabled={busy} onChange={e => { const option = options.find(o => encode(o.choice) === e.target.value); if (option) onChange(option.choice) }}>
    <option value="">{t($ => $.ask.noModel)}</option>{choice && !valid && <option value={encode(choice)} disabled>{t($ => $.ask.unavailableModel, { model: choice.modelId })}</option>}
    {options.map(option => <option key={encode(option.choice)} value={encode(option.choice)}>{option.label}</option>)}
  </Select>
}
