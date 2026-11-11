import { useTranslation } from 'react-i18next'
import { FormField, StatusMessage, TextInput } from '../../shared/ui'
import type { AITimeouts } from '../../shared/ai'

export function TimeoutSettings({ value, disabled, onChange }: { value: AITimeouts; disabled: boolean; onChange(value: AITimeouts): void }) {
  const { t } = useTranslation()
  const fields: { key: keyof AITimeouts; label: string }[] = [
    { key: 'requestSeconds', label: t($ => $.settings.requestTimeout) },
    { key: 'pageSeconds', label: t($ => $.settings.pageTimeout) },
    { key: 'modelsSeconds', label: t($ => $.settings.modelsTimeout) }
  ]
  return <>
    <StatusMessage>{t($ => $.settings.timeoutHelp)}</StatusMessage>
    {fields.map(field => <FormField key={field.key} label={field.label}>{props => <TextInput {...props} name={field.key} type="number" required min={1} max={3600} step={1} value={value[field.key] || ''} disabled={disabled} onChange={event => onChange({ ...value, [field.key]: Number(event.target.value) })} />}</FormField>)}
  </>
}
