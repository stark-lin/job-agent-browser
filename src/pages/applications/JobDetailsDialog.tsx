import { parseHttpUrl } from '../../shared/http-url'
import { Button, Dialog, DialogHeader, Link, MetadataList, MetadataListItem, Stack, Text } from '@astryxdesign/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import { ApplicationAgentPanel } from './ApplicationAgentPanel'
import { ApplicationEvents } from './ApplicationEvents'
import type { Job, JobSource } from '../../domain/job/job.types'

export function JobDetailsDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation(), { data } = useServices()
  const [job, setJob] = useState<Job | null>(null), [sources, setSources] = useState<JobSource[]>([]), [error, setError] = useState(false), [reload, setReload] = useState(0)
  useEffect(() => {
    let disposed = false
    setJob(null); setSources([]); setError(false)
    if (id) void (async () => {
      const job = await data.jobs.getJob({ id })
      if (!job.ok) throw new Error(job.error)
      const sources: JobSource[] = []
      for (;;) {
        const result = await data.jobs.listSources({ jobId: id, offset: sources.length, limit: 100 })
        if (!result.ok) throw new Error(result.error)
        sources.push(...result.value.items)
        if (sources.length >= result.value.total) break
        if (!result.value.items.length) throw new Error('STORAGE_UNAVAILABLE')
        if (disposed) return
      }
      if (!disposed) { setJob(job.value); setSources(sources) }
    })().catch(() => { if (!disposed) setError(true) })
    return () => { disposed = true }
  }, [data, id, reload])
  return <Dialog  isOpen={Boolean(id)} onOpenChange={() => onClose()} aria-label={t($ => $.jobs.details)} width={448} purpose="form">
      <DialogHeader title={t($ => $.jobs.details)} subtitle={job ? job.title : t($ => $.jobs.detailsHelp)} />
      <div className="dialog-content">{<div className="job-stack">
      {id && <ApplicationAgentPanel key={id} jobId={id} onChanged={() => { setReload(value => value + 1); onChanged() }} />}
    {error ? <><Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.jobs.loadFailed)}</Text><Button onClick={() => setReload(value => value + 1)} label={t($ => $.jobs.retry)} /></>
      : !job ? <Text as="p" type="supporting" role="status">{t($ => $.jobs.loading)}</Text> : <MetadataList>{([
        ...(['title', 'companyNameRaw', 'locationText', 'employmentType', 'description', 'notes'] as const).map(key => ({ label: t($ => $.jobs.fields[key]), value: job[key] || '—' })),
        { label: t($ => $.jobs.status), value: t($ => $.jobs.statuses[job.applicationStatus]) },
        { label: t($ => $.jobs.savedAt), value: new Date(job.savedAt).toLocaleString(i18n.language) },
        ...job.locations.map((location, index) => ({ label: t($ => $.jobs.locationEntry, { number: index + 1 }),
          value: [location.text, location.city, location.state, location.country, t($ => $.jobs.modes[location.mode])].filter(Boolean).join(' · ') })),
        { label: t($ => $.jobs.salary), value: job.salary ? [job.salary.text, [job.salary.min ?? '', job.salary.max ?? ''].join(' – '), job.salary.currency, t($ => $.jobs.periods[job.salary!.period])].filter(Boolean).join(' · ') : '—' },
        ...job.requirements.map((requirement, index) => ({ label: t($ => $.jobs.requirementEntry, { number: index + 1 }),
          value: [t($ => $.jobs.requirementTypes[requirement.type]), requirement.text, requirement.keywords.join(', ')].filter(Boolean).join('\n') })),
        { label: t($ => $.jobs.sources), value: sources.length ? <div className="job-stack">{sources.map(source => {
          const title = source.pageTitle || source.url
          const url = parseHttpUrl(source.url)
          return <div key={source.id}>
            {url ? <Link href={url.href} target="_blank" rel="noopener noreferrer">{title}</Link> : <span>{title}</span>}
            <div>{source.url}</div>
          </div>
        })}</div> : t($ => $.jobs.noSource) }
      ]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>}
      {id && <ApplicationEvents jobId={id} version={reload} />}
    </div>}</div>
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row"><Button data-autofocus="true" onClick={onClose} label={t($ => $.jobs.close)} /></Stack>
    </Dialog>
}
