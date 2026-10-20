import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, DataTable, FormField, PageHeading, SectionCard, Select, StatusMessage, TextInput } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'
import { useServices } from '../../app/providers'
import { applicationStatuses, type ApplicationStatus } from '../../domain/job/job.types'
import { jobsPageSize, useApplications } from './useApplications'
import { JobDetailsDialog } from './JobDetailsDialog'
import '../find-jobs/job.css'

export function ApplicationsPage() {
  const { t, i18n } = useTranslation(), { openPage } = useNavigation(), { context } = useServices(), viewer = useApplications()
  const [search, setSearch] = useState(''), [status, setStatus] = useState<ApplicationStatus | ''>('')
  const [selected, setSelected] = useState<string | null>(() => context.getSnapshot().jobId)
  return <main className="job-page"><div className="job-content">
    <div className="page-actions"><Button variant="ghost" onClick={() => void openPage('home')}>{t($ => $.navigation.goHome)}</Button></div>
    <PageHeading title={t($ => $.navigation.pages.applications)} description={t($ => $.jobs.listHelp)} />
    <SectionCard title={t($ => $.jobs.savedJobs)}><div className="job-stack">
      <form className="job-stack" onSubmit={event => { event.preventDefault(); setSelected(null); viewer.apply(search, status) }}>
        <div className="job-fields"><FormField label={t($ => $.jobs.search)}>{props => <TextInput {...props} name="jobSearch" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} />}</FormField>
          <FormField label={t($ => $.jobs.status)}>{props => <Select {...props} name="jobStatus" value={status} onChange={event => setStatus(event.target.value as ApplicationStatus | '')}><option value="">{t($ => $.jobs.allStatuses)}</option>{applicationStatuses.map(status => <option key={status} value={status}>{t($ => $.jobs.statuses[status])}</option>)}</Select>}</FormField></div>
        <div className="job-actions"><Button type="submit" disabled={viewer.loading}>{t($ => $.jobs.applyFilters)}</Button><Button disabled={viewer.loading} onClick={viewer.refresh}>{t($ => $.jobs.refresh)}</Button><Button variant="primary" onClick={() => void openPage('find')}>{t($ => $.navigation.pages.find)}</Button></div>
      </form>
      <div className="job-stack" aria-busy={viewer.loading}>
        {viewer.loading ? <StatusMessage>{t($ => $.jobs.loading)}</StatusMessage> : viewer.error ? <><StatusMessage tone="error">{t($ => $.jobs.loadFailed)}</StatusMessage><div><Button onClick={viewer.refresh}>{t($ => $.jobs.retry)}</Button></div></>
          : <>{!viewer.result.items.length ? <StatusMessage>{t($ => $.jobs.empty)}</StatusMessage> : <DataTable label={t($ => $.jobs.savedJobs)} rows={viewer.result.items} rowKey={job => job.id} columns={[
            { key: 'title', label: t($ => $.jobs.fields.title), render: job => job.title },
            { key: 'company', label: t($ => $.jobs.fields.companyNameRaw), render: job => job.companyNameRaw },
            { key: 'location', label: t($ => $.jobs.fields.locationText), render: job => job.locationText || '—' },
            { key: 'status', label: t($ => $.jobs.status), render: job => <Badge>{t($ => $.jobs.statuses[job.applicationStatus])}</Badge> },
            { key: 'savedAt', label: t($ => $.jobs.savedAt), render: job => <time dateTime={job.savedAt}>{new Date(job.savedAt).toLocaleString(i18n.language)}</time> },
            { key: 'details', label: t($ => $.jobs.details), render: job => <Button size="sm" aria-label={t($ => $.jobs.viewJob, { title: job.title })} onClick={() => { context.setReferences({ jobId: job.id }); setSelected(job.id) }}>{t($ => $.jobs.viewDetails)}</Button> }
          ]} />}
          <div className="job-actions"><StatusMessage>{t($ => $.jobs.pagination, { total: viewer.result.total, page: Math.floor(viewer.offset / jobsPageSize) + 1, pages: Math.max(1, Math.ceil(viewer.result.total / jobsPageSize)) })}</StatusMessage><Button disabled={!viewer.offset} onClick={viewer.previous}>{t($ => $.jobs.previous)}</Button><Button disabled={!viewer.hasNext} onClick={viewer.next}>{t($ => $.jobs.next)}</Button></div>
        </>}
      </div>
    </div></SectionCard>
    <JobDetailsDialog id={selected} onClose={() => setSelected(null)} />
  </div></main>
}
