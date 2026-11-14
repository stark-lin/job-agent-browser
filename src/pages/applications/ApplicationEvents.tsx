import { Button, Heading, MetadataList, MetadataListItem, Section, Stack, Text } from '@astryxdesign/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
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
  return <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.applicationAgent.events)}</Heading></summary>
      <div className="feature-section-body"><div className="job-stack">
    {loading ? <Text as="p" type="supporting" role="status">{t($ => $.jobs.loading)}</Text> : error ? <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.jobs.loadFailed)}</Text>
      : items.length ? <MetadataList>{(items.map(item => ({ label: t($ => $.applicationAgent.eventTypes[item.type]),
        value: [item.type === 'STATUS_CHANGED' || item.type === 'APPLICATION_SUBMITTED' ? t($ => $.jobs.statuses[item.metadata.toStatus!]) : item.title === 'NOTE' ? '' : item.title,
          item.description, new Date(item.startsAt ?? item.occurredAt).toLocaleString(i18n.language)].filter(Boolean).join('\n') }))).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList> : <Text as="p" type="supporting" role="status">{t($ => $.applicationAgent.noEvents)}</Text>}
    <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button isDisabled={loading || !offset} onClick={() => setOffset(value => Math.max(0, value - 25))} label={t($ => $.jobs.previous)} />
      <Button isDisabled={loading || offset + items.length >= total} onClick={() => setOffset(value => value + 25)} label={t($ => $.jobs.next)} /></Stack>
  </div></div></details></Section>
}
