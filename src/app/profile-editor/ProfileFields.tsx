import { useTranslation } from 'react-i18next'
import { ActionRow, Button, Checkbox, FormField, ListInput, Select, TextArea, TextInput } from '../../shared/ui'
import type { Contact, ProfileDetails, FactInput, ItemInput } from '../../domain/candidate/candidate.types'
import { importFactErrors, importItemErrors } from './field-errors'
import { factKinds, itemTypes } from '../../domain/candidate/candidate.types'

export const contactKeys = ['name', 'email', 'phone', 'location'] as const
export const basicKeys = [...contactKeys, 'introduction'] as const
export const emptyContact: ProfileDetails = { name: '', email: '', phone: '', location: '', links: [], introduction: '' }
export function ItemFields({ value, onChange, disabled = false, fixedType = false, review = false, resume = false }: {
  resume?: boolean; value: ItemInput; onChange: (value: ItemInput) => void; disabled?: boolean; fixedType?: boolean; review?: boolean
}) {
  const { t } = useTranslation(), metadata = value.metadata ?? {}
  const errors = review && !disabled ? importItemErrors(value) : {}
  const error = (key: string) => errors[key] ? t($ => key.startsWith('startDate') || key.startsWith('endDate') ? $.profile.dateError : $.profile.formatError) : undefined
  const education = ['degree', 'major', 'gpa'] as const, work = ['employmentType', 'technologies', 'url'] as const
  const extra = resume ? [...education, 'url' as const] : value.type === 'EDUCATION' ? [...education, ...work] : [...work, ...education]
  const patch = (key: keyof ItemInput, text: string) => onChange({ ...value, [key]: text })
  const meta = (key: keyof NonNullable<ItemInput['metadata']>, text: string | string[]) => onChange({ ...value, metadata: { ...metadata, [key]: text } })
  const date = (key: 'startDate' | 'endDate', text: string) => onChange({ ...value, [key]: text.length === 10 ? text : null, metadata: { ...metadata, [`${key}Text`]: text } })
  return <div className="profile-stack">
    {!resume && <FormField label={t($ => $.profile.type)} error={error('type')}>{props => <Select {...props} value={value.type} disabled={disabled || fixedType} onChange={event => patch('type', event.target.value)}>{itemTypes.map(type => <option key={type} value={type}>{t($ => $.profile.types[type])}</option>)}</Select>}</FormField>}
    <div className="profile-fields">{(['title', 'organization', 'role', 'location'] as const).map(key => <FormField key={key} label={t($ => $.profile[key])} error={error(key)}>{props => <TextInput {...props} value={value[key] ?? ''} required={!review && !resume && key === 'title'} maxLength={key === 'title' ? 500 : key === 'location' ? 1000 : 300} disabled={disabled} onChange={event => patch(key, event.target.value)} />}</FormField>)}</div>
    <div className="profile-fields">{(['startDate', 'endDate'] as const).map(key => <FormField key={key} label={t($ => $.profile[key])} help={t($ => $.profile.dateHelp)} error={error(`${key}Text`) || error(key)}>{props => <TextInput {...props} value={metadata[`${key}Text`] || value[key] || ''} maxLength={10} disabled={disabled || (key === 'endDate' && metadata.isCurrent && !metadata.endDateText && !value.endDate)} onChange={event => date(key, event.target.value)} />}</FormField>)}</div>
    <Checkbox label={t($ => $.profile.current)} checked={metadata.isCurrent ?? false} disabled={disabled} onChange={event => onChange({ ...value, endDate: event.target.checked ? null : value.endDate,
      metadata: { ...metadata, isCurrent: event.target.checked, endDateText: event.target.checked ? '' : metadata.endDateText } })} />
    {!resume && <FormField label={t($ => $.profile.summary)} error={error('summary')}>{props => <TextArea {...props} value={value.summary ?? ''} maxLength={20000} disabled={disabled} onChange={event => patch('summary', event.target.value)} />}</FormField>}
    <div className="profile-fields">{extra.map(key => <FormField key={key} label={t($ => $.profile[key])} error={error(key)}>{props => key === 'technologies'
      ? <ListInput {...props} value={metadata.technologies ?? []} maxLength={10100} disabled={disabled} onChange={values => meta(key, values)} />
      : <TextInput {...props} value={metadata[key] ?? ''} maxLength={key === 'url' ? 4096 : key === 'gpa' ? 50 : key === 'employmentType' ? 100 : 200} disabled={disabled} onChange={event => meta(key, event.target.value)} />}</FormField>)}</div>
  </div>
}
export function FactFields({ value, onChange, disabled = false, review = false }: { value: FactInput; onChange: (value: FactInput) => void; disabled?: boolean; review?: boolean }) {
  const { t } = useTranslation()
  const errors = review && !disabled ? importFactErrors(value) : {}
  const error = (key: string) => errors[key] ? t($ => $.profile.formatError) : undefined
  return <div className="profile-stack">
    <FormField label={t($ => $.profile.kind)} error={error('kind')}>{props => <Select {...props} value={value.kind} disabled={disabled} onChange={event => onChange({ ...value, kind: event.target.value as FactInput['kind'] })}>{factKinds.map(kind => <option key={kind} value={kind}>{t($ => $.profile.kinds[kind])}</option>)}</Select>}</FormField>
    <StatementField value={value.content} required={!review} disabled={disabled} error={error('content')} onChange={content => onChange({ ...value, content })} />
    <FormField label={t($ => $.profile.tags)} error={error('tags')}>{props => <ListInput {...props} value={value.tags ?? []} maxLength={10100} disabled={disabled} onChange={tags => onChange({ ...value, tags })} />}</FormField>
  </div>
}

export function StatementField({ value, onChange, disabled, required = false, error, label }: {
  value: string; onChange(value: string): void; disabled?: boolean; required?: boolean; error?: string; label?: string
}) {
  const { t } = useTranslation()
  return <FormField label={label ?? t($ => $.profile.content)} error={error}>{props =>
    <TextArea {...props} required={required} value={value} maxLength={20000} disabled={disabled} onChange={event => onChange(event.target.value)} />
  }</FormField>
}

export function ContactFields({ value, disabled, required, onChange }: {
  value: Contact; disabled: boolean; required?: boolean; onChange(value: Contact): void
}) {
  const { t } = useTranslation()
  return <>
    <div className="profile-fields">{contactKeys.map(key => <FormField key={key} label={t($ => $.profile[key])}>{props =>
      <TextInput {...props} value={value[key]} required={required && key === 'name'} maxLength={key === 'name' ? 300 : key === 'email' ? 320 : key === 'phone' ? 100 : 1000}
        disabled={disabled} onChange={event => onChange({ ...value, [key]: event.target.value })} />
    }</FormField>)}</div>
    {value.links.map((link, index) => <div className="profile-stack" key={index}>
      <div className="profile-fields">{(['label', 'url'] as const).map(key => <FormField key={key} label={t($ => $.profile[key])}>{props =>
        <TextInput {...props} value={link[key]} required={required} maxLength={key === 'label' ? 100 : 4096} disabled={disabled}
          onChange={event => onChange({ ...value, links: value.links.map((entry, i) => i === index ? { ...entry, [key]: event.target.value } : entry) })} />
      }</FormField>)}</div>
      <ActionRow><Button disabled={disabled} onClick={() => onChange({ ...value, links: value.links.filter((_, i) => i !== index) })}>{t($ => $.profile.remove)}</Button></ActionRow>
    </div>)}
    <ActionRow><Button disabled={disabled || value.links.length >= 20} onClick={() => onChange({ ...value, links: [...value.links, { label: '', url: '' }] })}>
      {t($ => $.profile.add)} {t($ => $.profile.links)}
    </Button></ActionRow>
  </>
}
