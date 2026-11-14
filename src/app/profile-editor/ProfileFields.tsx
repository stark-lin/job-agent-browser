import { Button, CheckboxInput, Selector, Stack, TextArea, TextInput } from '@astryxdesign/core'
import { useTranslation } from 'react-i18next'
import type { Contact, ProfileDetails, FactInput, ItemInput } from '../../domain/candidate/candidate.types'
import { importFactErrors, importItemErrors } from './field-errors'
import { factKinds, itemTypes } from '../../domain/candidate/candidate.types'

import { useDelimitedValues } from '../../shared/use-delimited-values'

export const contactKeys = ['name', 'email', 'phone', 'location'] as const
export const basicKeys = [...contactKeys, 'introduction'] as const
export const emptyContact: ProfileDetails = { name: '', email: '', phone: '', location: '', links: [], title: '', introduction: '' }
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
  const technologies = useDelimitedValues(metadata.technologies ?? [], values => meta('technologies', values))
  const date = (key: 'startDate' | 'endDate', text: string) => onChange({ ...value, [key]: text.length === 10 ? text : null, metadata: { ...metadata, [`${key}Text`]: text } })
  return <div className="profile-stack">
    {!resume && <Selector label={t($ => $.profile.type)} status={(error('type')) ? { type: 'error', message: error('type') } : undefined} value={value.type} isDisabled={disabled || fixedType} onChange={event => patch('type', event)}  options={[...(itemTypes.map(type => ({ value: type, label: t($ => $.profile.types[type]) })))]} />}
    <div className="profile-fields">{(['title', 'organization', 'role', 'location'] as const).map(key => <TextInput label={t($ => $.profile[key])} key={key} status={(error(key)) ? { type: 'error', message: error(key) } : undefined} value={value[key] ?? ''} ref={input => { if (input) { input.required = Boolean(!review && !resume && key === 'title'); input.maxLength = key === 'title' ? 500 : key === 'location' ? 1000 : 300 } }} isDisabled={disabled} onChange={event => patch(key, event)} />)}</div>
    <div className="profile-fields">{(['startDate', 'endDate'] as const).map(key => <TextInput label={t($ => $.profile[key])} key={key} description={resume ? undefined : t($ => $.profile.dateHelp)} status={(error(`${key}Text`) || error(key)) ? { type: 'error', message: error(`${key}Text`) || error(key) } : undefined} value={metadata[`${key}Text`] || value[key] || ''} ref={input => { if (input) { input.maxLength = resume ? 200 : 10 } }} isDisabled={disabled || (!resume && key === 'endDate' && metadata.isCurrent && !metadata.endDateText && !value.endDate)} onChange={event => date(key, event)} />)}</div>
    <CheckboxInput label={t($ => $.profile.current)} value={metadata.isCurrent ?? false} isDisabled={disabled} onChange={event => onChange({ ...value, endDate: event ? null : value.endDate,
      metadata: { ...metadata, isCurrent: event, endDateText: event ? '' : metadata.endDateText } })} />
    {!resume && <TextArea label={t($ => $.profile.summary)} status={(error('summary')) ? { type: 'error', message: error('summary') } : undefined} value={value.summary ?? ''} ref={input => { if (input) input.maxLength = 20000 }} isDisabled={disabled} onChange={event => patch('summary', event)} />}
    <div className="profile-fields">{extra.map(key => key === 'technologies'
      ? <TextInput label={t($ => $.profile[key])} key={key} status={error(key) ? { type: 'error', message: error(key) } : undefined} {...technologies} ref={input => { if (input) { input.maxLength = 10100 } }} isDisabled={disabled} />
      : <TextInput label={t($ => $.profile[key])} key={key} status={(error(key)) ? { type: 'error', message: error(key) } : undefined} value={metadata[key] ?? ''} ref={input => { if (input) { input.maxLength = key === 'url' ? 4096 : key === 'gpa' ? 50 : key === 'employmentType' ? 100 : 200 } }} isDisabled={disabled} onChange={event => meta(key, event)} />)}</div>
  </div>
}
export function FactFields({ value, onChange, disabled = false, review = false }: { value: FactInput; onChange: (value: FactInput) => void; disabled?: boolean; review?: boolean }) {
  const { t } = useTranslation()
  const errors = review && !disabled ? importFactErrors(value) : {}
  const tags = useDelimitedValues(value.tags ?? [], tags => onChange({ ...value, tags }))
  const error = (key: string) => errors[key] ? t($ => $.profile.formatError) : undefined
  return <div className="profile-stack">
    <Selector label={t($ => $.profile.kind)} status={(error('kind')) ? { type: 'error', message: error('kind') } : undefined} value={value.kind} isDisabled={disabled} onChange={selected => { const kind = factKinds.find(kind => kind === selected); if (kind) onChange({ ...value, kind }) }}  options={[...(factKinds.map(kind => ({ value: kind, label: t($ => $.profile.kinds[kind]) })))]} />
    <StatementField value={value.content} required={!review} disabled={disabled} error={error('content')} onChange={content => onChange({ ...value, content })} />
    <TextInput label={t($ => $.profile.tags)} status={error('tags') ? { type: 'error', message: error('tags') } : undefined} {...tags} ref={input => { if (input) { input.maxLength = 10100 } }} isDisabled={disabled} />
  </div>
}

export function StatementField({ value, onChange, disabled, required = false, error, label }: {
  value: string; onChange(value: string): void; disabled?: boolean; required?: boolean; error?: string; label?: string
}) {
  const { t } = useTranslation()
  return <TextArea label={label ?? t($ => $.profile.content)} status={(error) ? { type: 'error', message: error } : undefined} ref={input => { if (input) { input.required = Boolean(required); input.maxLength = 20000 } }} value={value}  isDisabled={disabled} onChange={event => onChange(event)} />
}

export function ContactFields({ value, disabled, required, onChange }: {
  value: Contact; disabled: boolean; required?: boolean; onChange(value: Contact): void
}) {
  const { t } = useTranslation()
  return <>
    <div className="profile-fields">{contactKeys.map(key => <TextInput label={t($ => $.profile[key])} key={key} value={value[key]} ref={input => { if (input) { input.required = Boolean(required && key === 'name'); input.maxLength = key === 'name' ? 300 : key === 'email' ? 320 : key === 'phone' ? 100 : 1000 } }}
        isDisabled={disabled} onChange={event => onChange({ ...value, [key]: event })} />)}</div>
    {value.links.map((link, index) => <div className="profile-stack" key={index}>
      <div className="profile-fields">{(['label', 'url'] as const).map(key => <TextInput label={t($ => $.profile[key])} key={key} value={link[key]} ref={input => { if (input) { input.required = Boolean(required); input.maxLength = key === 'label' ? 100 : 4096 } }} isDisabled={disabled}
          onChange={event => onChange({ ...value, links: value.links.map((entry, i) => i === index ? { ...entry, [key]: event } : entry) })} />)}</div>
      <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button isDisabled={disabled} onClick={() => onChange({ ...value, links: value.links.filter((_, i) => i !== index) })} label={t($ => $.profile.remove)} /></Stack>
    </div>)}
    <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button isDisabled={disabled || value.links.length >= 20} onClick={() => onChange({ ...value, links: [...value.links, { label: '', url: '' }] })} label={`${t($ => $.profile.add)} ${t($ => $.profile.links)}`} /></Stack>
  </>
}
