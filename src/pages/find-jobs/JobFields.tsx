import { useTranslation } from 'react-i18next'
import { Button, Checkbox, FormField, ListInput, SectionCard, Select, TextArea, TextInput } from '../../shared/ui'
import type { JobDetails } from '../../domain/job/job.types'

export function JobFields({ value, onChange, disabled }: { value: JobDetails; onChange: (value: JobDetails) => void; disabled: boolean }) {
  const { t } = useTranslation()
  const patch = <K extends keyof JobDetails>(key: K, next: JobDetails[K]) => onChange({ ...value, [key]: next })
  return <>
    <SectionCard title={t($ => $.jobs.basic)}><div className="job-stack">
      <div className="job-fields">{(['title', 'companyNameRaw', 'locationText', 'employmentType'] as const).map(key => <FormField key={key} label={t($ => $.jobs.fields[key])}>{props => <TextInput {...props} name={key} value={value[key]} required={key === 'title' || key === 'companyNameRaw'} maxLength={key === 'title' ? 500 : key === 'companyNameRaw' ? 300 : key === 'employmentType' ? 100 : 1000} disabled={disabled} onChange={event => patch(key, event.target.value)} />}</FormField>)}</div>
      <FormField label={t($ => $.jobs.fields.description)}>{props => <TextArea {...props} name="description" value={value.description} maxLength={100000} disabled={disabled} onChange={event => patch('description', event.target.value)} />}</FormField>
    </div></SectionCard>
    <SectionCard title={t($ => $.jobs.locations)}><div className="job-stack">
      {value.locations.map((location, index) => <SectionCard key={index} title={t($ => $.jobs.locationEntry, { number: index + 1 })}><div className="job-stack"><div className="job-fields">
        {(['text', 'city', 'state', 'country'] as const).map(key => <FormField key={key} label={t($ => $.jobs.locationFields[key])}>{props => <TextInput {...props} value={location[key]} maxLength={key === 'text' ? 1000 : 200} disabled={disabled} onChange={event => patch('locations', value.locations.map((entry, at) => at === index ? { ...entry, [key]: event.target.value } : entry))} />}</FormField>)}
        <FormField label={t($ => $.jobs.locationFields.mode)}>{props => <Select {...props} value={location.mode} disabled={disabled} onChange={event => patch('locations', value.locations.map((entry, at) => at === index ? { ...entry, mode: event.target.value as typeof entry.mode } : entry))}>{(['ONSITE', 'HYBRID', 'REMOTE'] as const).map(mode => <option key={mode} value={mode}>{t($ => $.jobs.modes[mode])}</option>)}</Select>}</FormField>
      </div><div><Button disabled={disabled} onClick={() => patch('locations', value.locations.filter((_, at) => at !== index))}>{t($ => $.jobs.remove)}</Button></div></div></SectionCard>)}
      <div><Button disabled={disabled || value.locations.length >= 50} onClick={() => patch('locations', [...value.locations, { text: '', city: '', state: '', country: '', mode: 'ONSITE' }])}>{t($ => $.jobs.addLocation)}</Button></div>
    </div></SectionCard>
    <SectionCard title={t($ => $.jobs.salary)}><div className="job-stack">
      <Checkbox label={t($ => $.jobs.includeSalary)} checked={value.salary !== null} disabled={disabled} onChange={event => patch('salary', event.target.checked ? { min: null, max: null, currency: '', text: '', period: 'YEAR' } : null)} />
      {value.salary && <div className="job-fields">
        {(['min', 'max'] as const).map(key => <FormField key={key} label={t($ => $.jobs.salaryFields[key])}>{props => <TextInput {...props} name={`salary.${key}`} type="number" min="0" step="any" value={value.salary![key] ?? ''} disabled={disabled} onChange={event => patch('salary', { ...value.salary!, [key]: event.target.value === '' ? null : event.target.valueAsNumber })} />}</FormField>)}
        <FormField label={t($ => $.jobs.salaryFields.currency)} help={t($ => $.jobs.currencyHelp)}>{props => <TextInput {...props} name="salary.currency" required minLength={3} maxLength={3} value={value.salary!.currency} disabled={disabled} onChange={event => patch('salary', { ...value.salary!, currency: event.target.value.toUpperCase() })} />}</FormField>
        <FormField label={t($ => $.jobs.salaryFields.period)}>{props => <Select {...props} value={value.salary!.period} disabled={disabled} onChange={event => patch('salary', { ...value.salary!, period: event.target.value as NonNullable<JobDetails['salary']>['period'] })}>{(['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as const).map(period => <option key={period} value={period}>{t($ => $.jobs.periods[period])}</option>)}</Select>}</FormField>
        <FormField label={t($ => $.jobs.salaryFields.text)}>{props => <TextInput {...props} value={value.salary!.text} maxLength={1000} disabled={disabled} onChange={event => patch('salary', { ...value.salary!, text: event.target.value })} />}</FormField>
      </div>}
    </div></SectionCard>
    <SectionCard title={t($ => $.jobs.requirements)}><div className="job-stack">
      {value.requirements.map((requirement, index) => <SectionCard key={index} title={t($ => $.jobs.requirementEntry, { number: index + 1 })}><div className="job-stack">
        <FormField label={t($ => $.jobs.requirementFields.text)}>{props => <TextArea {...props} value={requirement.text} required maxLength={4000} disabled={disabled} onChange={event => patch('requirements', value.requirements.map((entry, at) => at === index ? { ...entry, text: event.target.value } : entry))} />}</FormField>
        <div className="job-fields"><FormField label={t($ => $.jobs.requirementFields.type)}>{props => <Select {...props} value={requirement.type} disabled={disabled} onChange={event => patch('requirements', value.requirements.map((entry, at) => at === index ? { ...entry, type: event.target.value as typeof entry.type } : entry))}>{(['REQUIRED', 'PREFERRED', 'OTHER'] as const).map(type => <option key={type} value={type}>{t($ => $.jobs.requirementTypes[type])}</option>)}</Select>}</FormField>
          <FormField label={t($ => $.jobs.requirementFields.keywords)}>{props => <ListInput {...props} value={requirement.keywords} maxLength={5050} disabled={disabled} onChange={keywords => patch('requirements', value.requirements.map((entry, at) => at === index ? { ...entry, keywords } : entry))} />}</FormField></div>
        <div><Button disabled={disabled} onClick={() => patch('requirements', value.requirements.filter((_, at) => at !== index))}>{t($ => $.jobs.remove)}</Button></div>
      </div></SectionCard>)}
      <div><Button disabled={disabled || value.requirements.length >= 200} onClick={() => patch('requirements', [...value.requirements, { text: '', type: 'REQUIRED', keywords: [] }])}>{t($ => $.jobs.addRequirement)}</Button></div>
    </div></SectionCard>
    <SectionCard title={t($ => $.jobs.fields.notes)}><FormField label={t($ => $.jobs.fields.notes)}>{props => <TextArea {...props} name="notes" value={value.notes} maxLength={20000} disabled={disabled} onChange={event => patch('notes', event.target.value)} />}</FormField></SectionCard>
  </>
}
