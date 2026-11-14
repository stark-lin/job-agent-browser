import { Badge, Button, CheckboxInput, Heading, Section, Selector, Stack, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, TextInput } from '@astryxdesign/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigation } from '../../app/navigation/navigate'
import { useServices } from '../../app/providers'
import { applicationStatuses, type ApplicationStatus } from '../../domain/job/job.types'
import { jobsPageSize, useApplications } from './useApplications'
import { JobDetailsDialog } from './JobDetailsDialog'
import '../find-jobs/job.css'

export function ApplicationsPage() {
  const { t, i18n } = useTranslation(), { openPage } = useNavigation(), { context } = useServices(), viewer = useApplications()
  const [search, setSearch] = useState(''), [status, setStatus] = useState<ApplicationStatus | ''>('')
  const [archived, setArchived] = useState(false)
  const [selected, setSelected] = useState<string | null>(() => context.getSnapshot().jobId)
  return <main className="job-page" aria-label={t($ => $.navigation.pages.applications)}><div className="job-content">
    <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.jobs.savedJobs)}</Heading></summary>
      <div className="feature-section-body"><div className="job-stack">
      <form className="job-stack" onSubmit={event => { event.preventDefault(); setSelected(null); viewer.apply(search, status, archived) }}>
        <div className="job-fields"><TextInput label={t($ => $.jobs.search)} htmlName="jobSearch" value={search} ref={input => { if (input) { input.maxLength = 200 } }} onChange={event => setSearch(event)} />
          <Selector label={t($ => $.jobs.status)} htmlName="jobStatus" value={status} onChange={selected => setStatus(applicationStatuses.find(status => status === selected) ?? '')}  options={[({ value: "", label: t($ => $.jobs.allStatuses) }), ...(applicationStatuses.map(status => ({ value: status, label: t($ => $.jobs.statuses[status]) })))]} /></div>
        <CheckboxInput label={t($ => $.applicationAgent.archivedJobs)} htmlName="archivedJobs" value={archived} onChange={event => setArchived(event)} />
        <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button type="submit" isDisabled={viewer.loading} label={t($ => $.jobs.applyFilters)} /><Button isDisabled={viewer.loading} onClick={viewer.refresh} label={t($ => $.jobs.refresh)} /><Button variant="primary" onClick={() => void openPage('find')} label={t($ => $.navigation.pages.find)} /></Stack>
      </form>
      <div className="job-stack" aria-busy={viewer.loading}>
        {viewer.loading ? <Text as="p" type="supporting" role="status">{t($ => $.jobs.loading)}</Text> : viewer.error ? <><Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.jobs.loadFailed)}</Text><Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button onClick={viewer.refresh} label={t($ => $.jobs.retry)} /></Stack></>
          : <>{!viewer.result.items.length ? <Text as="p" type="supporting" role="status">{t($ => $.jobs.empty)}</Text> : <div className="applications-table" role="region" aria-label={t($ => $.jobs.savedJobs)} tabIndex={0}>
            <Table aria-label={t($ => $.jobs.savedJobs)} density="compact" textOverflow="truncate" hasHover>
              <TableHeader><TableRow isHeaderRow>
                <TableHeaderCell>{t($ => $.jobs.fields.title)}</TableHeaderCell>
                <TableHeaderCell>{t($ => $.jobs.fields.companyNameRaw)}</TableHeaderCell>
                <TableHeaderCell>{t($ => $.jobs.fields.locationText)}</TableHeaderCell>
                <TableHeaderCell>{t($ => $.jobs.status)}</TableHeaderCell>
                <TableHeaderCell>{t($ => $.jobs.savedAt)}</TableHeaderCell>
              </TableRow></TableHeader>
              <TableBody>{viewer.result.items.map(job => <TableRow key={job.id} onClick={event => {
                event.currentTarget.querySelector('button')?.focus({ preventScroll: true })
                context.setReferences({ jobId: job.id })
                setSelected(job.id)
              }}>
                <TableCell><Button variant="ghost" size="sm" aria-haspopup="dialog" label={t($ => $.jobs.viewJob, { title: job.title })}>
                  {job.title.split(/\r\n?|\n/, 1)[0]}
                </Button></TableCell>
                <TableCell>{job.companyNameRaw.split(/\r\n?|\n/, 1)[0]}</TableCell>
                <TableCell>{job.locationText.split(/\r\n?|\n/, 1)[0] || '—'}</TableCell>
                <TableCell><Badge label={t($ => $.jobs.statuses[job.applicationStatus])} /></TableCell>
                <TableCell><time dateTime={job.savedAt}>{new Date(job.savedAt).toLocaleString(i18n.language)}</time></TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </div>}
          <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Text as="p" type="supporting" role="status">{t($ => $.jobs.pagination, { total: viewer.result.total, page: Math.floor(viewer.offset / jobsPageSize) + 1, pages: Math.max(1, Math.ceil(viewer.result.total / jobsPageSize)) })}</Text><Button isDisabled={!viewer.offset} onClick={viewer.previous} label={t($ => $.jobs.previous)} /><Button isDisabled={!viewer.hasNext} onClick={viewer.next} label={t($ => $.jobs.next)} /></Stack>
        </>}
      </div>
    </div></div></details></Section>
    <JobDetailsDialog id={selected} onChanged={viewer.refresh} onClose={() => setSelected(null)} />
  </div></main>
}
