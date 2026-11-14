import { Selector } from '@astryxdesign/core'
import { useTranslation } from 'react-i18next'
import type { AIChoice, AISettings } from '../../shared/ai'
export function ModelPicker({ config, choice, busy, onChange }: { config: AISettings | null; choice: AIChoice | null; busy: boolean; onChange(choice: AIChoice): void }) {
  const { t } = useTranslation(), encode = (value: AIChoice) => JSON.stringify([value.providerId, value.modelId])
  const options = config?.providers.flatMap(p => p.models.map(modelId => ({ choice: { providerId: p.id, modelId }, label: `${p.name} · ${modelId}` }))) ?? []
  const valid = options.some(option => choice && encode(option.choice) === encode(choice))
  return <Selector size="sm" width="min(160px, 36vw)" value={choice ? encode(choice) : ''} isDisabled={busy} onChange={e => { const option = options.find(o => encode(o.choice) === e); if (option) onChange(option.choice) }}  isLabelHidden label={t($ => $.ask.model)} options={[({ value: "", label: t($ => $.ask.noModel) }), ...(choice && !valid  ? [({ value: encode(choice), label: t($ => $.ask.unavailableModel, { model: choice.modelId }), disabled: true })] : []), ...(options.map(option => ({ value: encode(option.choice), label: option.label })))]} />
}
