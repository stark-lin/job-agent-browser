import { Button, CheckboxInput, Heading, NumberInput, Section, Selector, Stack, TextArea, TextInput } from '@astryxdesign/core'
import { useDelimitedValues } from '../../shared/use-delimited-values'
import { useTranslation } from 'react-i18next'
import type { JobDetails } from '../../domain/job/job.types'

const locationModes = ['ONSITE', 'HYBRID', 'REMOTE'] as const
const salaryPeriods = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as const
const requirementTypes = ['REQUIRED', 'PREFERRED', 'OTHER'] as const

export function JobFields({ value, onChange, disabled }: { value: JobDetails; onChange: (value: JobDetails) => void; disabled: boolean }) {
  const { t } = useTranslation()
  const patch = <K extends keyof JobDetails>(key: K, next: JobDetails[K]) => onChange({ ...value, [key]: next })
  return <>
    <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.jobs.basic)}</Heading></summary>
      <div className="feature-section-body"><div className="job-stack">
      <div className="job-fields">{(['title', 'companyNameRaw', 'locationText', 'employmentType'] as const).map(key => <TextInput label={t($ => $.jobs.fields[key])} key={key} htmlName={key} value={value[key]} ref={input => { if (input) { input.required = Boolean(key === 'title' || key === 'companyNameRaw'); input.maxLength = key === 'title' ? 500 : key === 'companyNameRaw' ? 300 : key === 'employmentType' ? 100 : 1000 } }} isDisabled={disabled} onChange={event => patch(key, event)} />)}</div>
      <TextArea label={t($ => $.jobs.fields.description)} htmlName="description" value={value.description} ref={input => { if (input) input.maxLength = 100000 }} isDisabled={disabled} onChange={event => patch('description', event)} />
    </div></div></details></Section>
    <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.jobs.locations)}</Heading></summary>
      <div className="feature-section-body"><div className="job-stack">
      {value.locations.map((location, index) => <Section key={index} className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.jobs.locationEntry, { number: index + 1 })}</Heading></summary>
      <div className="feature-section-body"><div className="job-stack"><div className="job-fields">
        {(['text', 'city', 'state', 'country'] as const).map(key => <TextInput label={t($ => $.jobs.locationFields[key])} key={key} value={location[key]} ref={input => { if (input) { input.maxLength = key === 'text' ? 1000 : 200 } }} isDisabled={disabled} onChange={event => patch('locations', value.locations.map((entry, at) => at === index ? { ...entry, [key]: event } : entry))} />)}
        <Selector label={t($ => $.jobs.locationFields.mode)} value={location.mode} isDisabled={disabled} onChange={selected => {
          const mode = locationModes.find(mode => mode === selected)
          if (mode) patch('locations', value.locations.map((entry, at) => at === index ? { ...entry, mode } : entry))
        }}  options={[...(locationModes.map(mode => ({ value: mode, label: t($ => $.jobs.modes[mode]) })))]} />
      </div><Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button isDisabled={disabled} onClick={() => patch('locations', value.locations.filter((_, at) => at !== index))} label={t($ => $.jobs.remove)} /></Stack></div></div></details></Section>)}
      <Button variant="secondary" isDisabled={disabled || value.locations.length >= 50} onClick={() => patch('locations', [...value.locations, { text: '', city: '', state: '', country: '', mode: 'ONSITE' }])} className="add-record" label={t($ => $.jobs.addLocation)} />
    </div></div></details></Section>
    <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.jobs.salary)}</Heading></summary>
      <div className="feature-section-body"><div className="job-stack">
      <CheckboxInput label={t($ => $.jobs.includeSalary)} value={value.salary !== null} isDisabled={disabled} onChange={event => patch('salary', event ? { min: null, max: null, currency: '', text: '', period: 'YEAR' } : null)} />
      {value.salary && <div className="job-fields">
        {(['min', 'max'] as const).map(key => <NumberInput label={t($ => $.jobs.salaryFields[key])} key={key} htmlName={`salary.${key}`} min={0} hasClear value={value.salary?.[key]} isDisabled={disabled} onChange={amount => { if (value.salary) patch('salary', { ...value.salary, [key]: amount }) }} />)}
        <TextInput label={t($ => $.jobs.salaryFields.currency)} description={t($ => $.jobs.currencyHelp)} htmlName="salary.currency" ref={input => { if (input) { input.required = true; input.minLength = 3; input.maxLength = 3 } }}  value={value.salary!.currency} isDisabled={disabled} onChange={event => patch('salary', { ...value.salary!, currency: event.toUpperCase() })} />
        <Selector label={t($ => $.jobs.salaryFields.period)} value={value.salary!.period} isDisabled={disabled} onChange={selected => {
          const period = salaryPeriods.find(period => period === selected)
          if (period && value.salary) patch('salary', { ...value.salary, period })
        }}  options={[...(salaryPeriods.map(period => ({ value: period, label: t($ => $.jobs.periods[period]) })))]} />
        <TextInput label={t($ => $.jobs.salaryFields.text)} value={value.salary!.text} ref={input => { if (input) { input.maxLength = 1000 } }} isDisabled={disabled} onChange={event => patch('salary', { ...value.salary!, text: event })} />
      </div>}
    </div></div></details></Section>
    <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.jobs.requirements)}</Heading></summary>
      <div className="feature-section-body"><div className="job-stack">
      {value.requirements.map((requirement, index) => <RequirementFields key={index} value={requirement} index={index} disabled={disabled}
        onChange={updated => patch('requirements', value.requirements.map((entry, at) => at === index ? updated : entry))}
        onRemove={() => patch('requirements', value.requirements.filter((_, at) => at !== index))} />)}
      <Button variant="secondary" isDisabled={disabled || value.requirements.length >= 200} onClick={() => patch('requirements', [...value.requirements, { text: '', type: 'REQUIRED', keywords: [] }])} className="add-record" label={t($ => $.jobs.addRequirement)} />
    </div></div></details></Section>
    <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.jobs.fields.notes)}</Heading></summary>
      <div className="feature-section-body"><TextArea label={t($ => $.jobs.fields.notes)} htmlName="notes" value={value.notes} ref={input => { if (input) input.maxLength = 20000 }} isDisabled={disabled} onChange={event => patch('notes', event)} /></div></details></Section>
  </>
}

function RequirementFields({ value, index, disabled, onChange, onRemove }: {
  value: JobDetails['requirements'][number]; index: number; disabled: boolean
  onChange(value: JobDetails['requirements'][number]): void; onRemove(): void
}) {
  const { t } = useTranslation()
  const keywords = useDelimitedValues(value.keywords, keywords => onChange({ ...value, keywords }))
  return <Section className="feature-section" padding={0}>
    <details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.jobs.requirementEntry, { number: index + 1 })}</Heading></summary>
      <div className="feature-section-body job-stack">
        <TextArea label={t($ => $.jobs.requirementFields.text)} value={value.text} ref={input => { if (input) { input.required = true; input.maxLength = 4000 } }}  isDisabled={disabled}
          onChange={text => onChange({ ...value, text })} />
        <div className="job-fields">
          <Selector label={t($ => $.jobs.requirementFields.type)} value={value.type} isDisabled={disabled}
            onChange={selected => { const type = requirementTypes.find(type => type === selected); if (type) onChange({ ...value, type }) }}
            options={requirementTypes.map(type => ({ value: type, label: t($ => $.jobs.requirementTypes[type]) }))} />
          <TextInput label={t($ => $.jobs.requirementFields.keywords)} {...keywords} ref={input => { if (input) { input.maxLength = 5050 } }} isDisabled={disabled} />
        </div>
        <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
          <Button isDisabled={disabled} onClick={onRemove} label={t($ => $.jobs.remove)} />
        </Stack>
      </div>
    </details>
  </Section>
}
