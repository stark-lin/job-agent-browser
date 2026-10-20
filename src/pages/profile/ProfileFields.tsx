import { useTranslation } from 'react-i18next'
import { Checkbox, FormField, ListInput, Select, TextArea, TextInput } from '../../shared/ui'
import type { Contact, FactInput, ItemInput } from '../../domain/candidate/candidate.types'
import { factKinds, itemTypes } from '../../domain/candidate/candidate.types'

export const contactKeys = ['name', 'email', 'phone', 'location'] as const
export const emptyContact: Contact = { name: '', email: '', phone: '', location: '', links: [] }
export function ItemFields({ value, onChange, disabled = false, fixedType = false }: {
  value: ItemInput; onChange: (value: ItemInput) => void; disabled?: boolean; fixedType?: boolean
}) {
  const { t } = useTranslation(), metadata = value.metadata ?? {}
  const patch = (key: keyof ItemInput, text: string) => onChange({ ...value, [key]: text })
  const meta = (key: keyof NonNullable<ItemInput['metadata']>, text: string | string[]) => onChange({ ...value, metadata: { ...metadata, [key]: text } })
  const date = (key: 'startDate' | 'endDate', text: string) => onChange({ ...value, [key]: text.length === 10 ? text : null, metadata: { ...metadata, [`${key}Text`]: text } })
  return <div className="profile-stack">
    <FormField label={t($ => $.profile.type)}>{props => <Select {...props} value={value.type} disabled={disabled || fixedType} onChange={event => patch('type', event.target.value)}>{itemTypes.map(type => <option key={type} value={type}>{t($ => $.profile.types[type])}</option>)}</Select>}</FormField>
    <div className="profile-fields">{(['title', 'organization', 'role', 'location'] as const).map(key => <FormField key={key} label={t($ => $.profile[key])}>{props => <TextInput {...props} value={value[key] ?? ''} required={key === 'title'} maxLength={key === 'title' ? 500 : key === 'location' ? 1000 : 300} disabled={disabled} onChange={event => patch(key, event.target.value)} />}</FormField>)}</div>
    <div className="profile-fields">{(['startDate', 'endDate'] as const).map(key => <FormField key={key} label={t($ => $.profile[key])} help={t($ => $.profile.dateHelp)}>{props => <TextInput {...props} value={metadata[`${key}Text`] || value[key] || ''} maxLength={10} disabled={disabled || (key === 'endDate' && metadata.isCurrent)} onChange={event => date(key, event.target.value)} />}</FormField>)}</div>
    <Checkbox label={t($ => $.profile.current)} checked={metadata.isCurrent ?? false} disabled={disabled} onChange={event => onChange({ ...value, endDate: event.target.checked ? null : value.endDate,
      metadata: { ...metadata, isCurrent: event.target.checked, endDateText: event.target.checked ? '' : metadata.endDateText } })} />
    <FormField label={t($ => $.profile.summary)}>{props => <TextArea {...props} value={value.summary ?? ''} maxLength={20000} disabled={disabled} onChange={event => patch('summary', event.target.value)} />}</FormField>
    <div className="profile-fields">{(value.type === 'EDUCATION' ? ['degree', 'major', 'gpa'] as const : ['employmentType', 'technologies', 'url'] as const).map(key => <FormField key={key} label={t($ => $.profile[key])}>{props => key === 'technologies'
      ? <ListInput {...props} value={metadata.technologies ?? []} maxLength={10100} disabled={disabled} onChange={values => meta(key, values)} />
      : <TextInput {...props} value={metadata[key] ?? ''} maxLength={key === 'url' ? 4096 : key === 'gpa' ? 50 : key === 'employmentType' ? 100 : 200} disabled={disabled} onChange={event => meta(key, event.target.value)} />}</FormField>)}</div>
  </div>
}
export function FactFields({ value, onChange, disabled = false }: { value: FactInput; onChange: (value: FactInput) => void; disabled?: boolean }) {
  const { t } = useTranslation()
  return <div className="profile-stack">
    <FormField label={t($ => $.profile.kind)}>{props => <Select {...props} value={value.kind} disabled={disabled} onChange={event => onChange({ ...value, kind: event.target.value as FactInput['kind'] })}>{factKinds.map(kind => <option key={kind} value={kind}>{t($ => $.profile.kinds[kind])}</option>)}</Select>}</FormField>
    <FormField label={t($ => $.profile.content)}>{props => <TextArea {...props} required value={value.content} maxLength={20000} disabled={disabled} onChange={event => onChange({ ...value, content: event.target.value })} />}</FormField>
    <FormField label={t($ => $.profile.tags)}>{props => <ListInput {...props} value={value.tags ?? []} maxLength={10100} disabled={disabled} onChange={tags => onChange({ ...value, tags })} />}</FormField>
    <FormField label={t($ => $.profile.evidence)}>{props => <TextArea {...props} value={value.evidence ?? ''} maxLength={20000} disabled={disabled} onChange={event => onChange({ ...value, evidence: event.target.value })} />}</FormField>
  </div>
}
