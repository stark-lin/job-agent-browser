import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import { Button, DetailsList, SectionCard, StatusMessage } from '../../shared/ui'
import type { JobEvent } from '../../domain/application/application.types'

export function ApplicationEvents({ jobId, version }: { jobId: string; version: number }) {
  const { data } = useServices(), { t, i18n } = useTranslation()
  const [items, setItems] = useState<JobEvent[]>([]), [offset, setOffset] = useState(0), [total, setTotal] = useState(0), [error, setError] = useState(false), [loading, setLoading] = useState(true)
  useEffect(() => { setOffset(0) }, [jobId, version])
  useEffect(() => {
    let disposed = false
    setLoading(true); setError(false)
    void data.applications.listEvents({ jobId, offset, limit: 25 }).then(result => {
      if (disposed) return
      if (result.ok) { setItems(result.value.items); setTotal(result.value.total) } else setError(true)
    }).catch(() => { if (!disposed) setError(true) }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [data, jobId, offset, version])
  return <SectionCard title={t($ => $.applicationAgent.events)}><div className="job-stack">
    {loading ? <StatusMessage>{t($ => $.jobs.loading)}</StatusMessage> : error ? <StatusMessage tone="error">{t($ => $.jobs.loadFailed)}</StatusMessage>
      : items.length ? <DetailsList items={items.map(item => ({ label: t($ => $.applicationAgent.eventTypes[item.type]),
        value: [item.type === 'STATUS_CHANGED' || item.type === 'APPLICATION_SUBMITTED' ? t($ => $.jobs.statuses[item.metadata.toStatus!]) : item.title === 'NOTE' ? '' : item.title,
          item.description, new Date(item.startsAt ?? item.occurredAt).toLocaleString(i18n.language)].filter(Boolean).join('\n') }))} /> : <StatusMessage>{t($ => $.applicationAgent.noEvents)}</StatusMessage>}
    <div className="job-actions"><Button disabled={loading || !offset} onClick={() => setOffset(value => Math.max(0, value - 25))}>{t($ => $.jobs.previous)}</Button>
      <Button disabled={loading || offset + items.length >= total} onClick={() => setOffset(value => value + 25)}>{t($ => $.jobs.next)}</Button></div>
  </div></SectionCard>
}
