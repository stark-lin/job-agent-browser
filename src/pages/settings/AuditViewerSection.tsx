import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuditEntry } from '../../domain/common/ports'
import { Badge, Button, DataTable, DetailsList, Dialog, FormField, SectionCard, Select, StatusMessage, TextInput } from '../../shared/ui'
import { auditTargets, emptyAuditDraft, parseAuditDraft, type AuditDraft, type AuditFilterError } from './audit-filters'
import { auditPageSize, useAuditViewer } from './useAuditViewer'

export function AuditViewerSection() {
  const { t, i18n } = useTranslation(), viewer = useAuditViewer(), advancedId = useId()
  const [draft, setDraft] = useState<AuditDraft>({ ...emptyAuditDraft })
  const [advanced, setAdvanced] = useState(false), [error, setError] = useState<AuditFilterError | null>(null)
  const [selected, setSelected] = useState<AuditEntry | null>(null)
  const change = <K extends keyof AuditDraft>(field: K, value: AuditDraft[K]) => { setDraft(current => ({ ...current, [field]: value })); setError(null) }
  const formatTime = (timestamp: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(timestamp))
  const status = (entry: AuditEntry) => <Badge tone={entry.status === 'SUCCESS' ? 'success' : 'error'}>{t($ => $.audit.statuses[entry.status])}</Badge>
  const submit = () => {
    const parsed = parseAuditDraft(draft)
    if (!parsed.ok) { setError(parsed.field); if (['targetId', 'requestId', 'transactionId'].includes(parsed.field)) setAdvanced(true); return }
    setError(null); setSelected(null); viewer.apply(parsed.filter)
  }
  const details = selected && [
    { label: t($ => $.audit.recordId), value: selected.id },
    { label: t($ => $.audit.sequence), value: selected.sequence },
    { label: t($ => $.audit.time), value: <><time dateTime={selected.timestamp}>{formatTime(selected.timestamp)}</time><br />{selected.timestamp}</> },
    { label: t($ => $.audit.event), value: selected.eventType },
    { label: t($ => $.audit.action), value: t($ => $.audit.actions[selected.action]) },
    { label: t($ => $.audit.targetType), value: t($ => $.audit.targets[selected.targetType]) },
    { label: t($ => $.audit.targetId), value: selected.targetId ?? t($ => $.audit.noValue) },
    { label: t($ => $.audit.status), value: status(selected) },
    { label: t($ => $.audit.errorCode), value: selected.error ?? t($ => $.audit.noValue) },
    { label: t($ => $.audit.requestId), value: selected.requestId },
    { label: t($ => $.audit.transactionId), value: selected.transactionId },
    { label: t($ => $.audit.component), value: selected.component },
    { label: t($ => $.audit.location), value: selected.location },
    { label: t($ => $.audit.source), value: selected.source },
    { label: t($ => $.audit.actor), value: selected.actorId }
  ]
  return <div className="audit-viewer" data-audit-viewer>
    <SectionCard title={t($ => $.audit.title)} description={t($ => $.audit.description)}>
      <div className="settings-stack">
        <form className="settings-stack" data-audit-filters noValidate onSubmit={event => { event.preventDefault(); submit() }}>
          <div className="settings-fields">
            <FormField label={t($ => $.audit.targetType)}>{props => <Select {...props} name="targetType" value={draft.targetType} onChange={event => change('targetType', event.target.value as AuditDraft['targetType'])}>
              <option value="">{t($ => $.audit.all)}</option>{auditTargets.map(target => <option key={target} value={target}>{t($ => $.audit.targets[target])}</option>)}
            </Select>}</FormField>
            <FormField label={t($ => $.audit.status)}>{props => <Select {...props} name="status" value={draft.status} onChange={event => change('status', event.target.value as AuditDraft['status'])}>
              <option value="">{t($ => $.audit.all)}</option><option value="SUCCESS">{t($ => $.audit.statuses.SUCCESS)}</option><option value="FAILURE">{t($ => $.audit.statuses.FAILURE)}</option>
            </Select>}</FormField>
            {(['from', 'to'] as const).map(field => <FormField key={field} label={t($ => $.audit[field])} help={t($ => $.audit.localTime)} error={error === field ? t($ => $.audit.invalidTime) : field === 'to' && error === 'range' ? t($ => $.audit.invalidRange) : undefined}>{props => <TextInput {...props} name={field} type="datetime-local" step="1" value={draft[field]} onChange={event => change(field, event.target.value)} />}</FormField>)}
          </div>
          <div><Button aria-expanded={advanced} aria-controls={advancedId} onClick={() => setAdvanced(value => !value)}>{t($ => $.audit.advanced)}</Button></div>
          <div id={advancedId} className="settings-fields" hidden={!advanced}>
            {(['targetId', 'requestId', 'transactionId'] as const).map(field => <FormField key={field} label={t($ => $.audit[field])} help={t($ => $.audit.exactMatch)} error={error === field ? t($ => $.audit.invalidId) : undefined}>{props => <TextInput {...props} name={field} value={draft[field]} maxLength={field === 'targetId' ? 120 : 36} onChange={event => change(field, event.target.value)} />}</FormField>)}
          </div>
          <div className="page-actions">
            <Button variant="primary" type="submit" disabled={viewer.loading}>{t($ => $.audit.query)}</Button>
            <Button disabled={viewer.loading} onClick={() => { setDraft({ ...emptyAuditDraft }); setError(null); setSelected(null); viewer.apply({}) }}>{t($ => $.audit.reset)}</Button>
            <Button disabled={viewer.loading} onClick={viewer.refresh}>{t($ => $.audit.refresh)}</Button>
          </div>
        </form>
        <StatusMessage>{t($ => $.audit.scope)}</StatusMessage>
        <div className="settings-stack" aria-busy={viewer.loading}>
          {viewer.loading ? <StatusMessage>{t($ => $.audit.loading)}</StatusMessage> : viewer.failed ? <>
            <StatusMessage tone="error">{t($ => $.audit.loadFailed)}</StatusMessage><div><Button onClick={viewer.refresh}>{t($ => $.settings.retry)}</Button></div>
          </> : <>
            {!viewer.result.items.length ? <StatusMessage>{viewer.filtered ? t($ => $.audit.noMatches) : t($ => $.audit.empty)}</StatusMessage> : <DataTable label={t($ => $.audit.title)} rows={viewer.result.items} rowKey={entry => entry.id} columns={[
              { key: 'time', label: t($ => $.audit.time), render: entry => <time dateTime={entry.timestamp}>{formatTime(entry.timestamp)}</time> },
              { key: 'event', label: t($ => $.audit.event), render: entry => <>{entry.eventType}<br />{t($ => $.audit.actions[entry.action])}</> },
              { key: 'target', label: t($ => $.audit.target), render: entry => <>{t($ => $.audit.targets[entry.targetType])}<br />{entry.targetId ?? t($ => $.audit.noValue)}</> },
              { key: 'status', label: t($ => $.audit.status), render: status },
              { key: 'details', label: t($ => $.audit.details), render: entry => <Button size="sm" aria-label={t($ => $.audit.viewEntry, { sequence: entry.sequence })} onClick={() => setSelected(entry)}>{t($ => $.audit.viewDetails)}</Button> }
            ]} />}
            <div className="settings-actions" data-audit-pagination>
              <StatusMessage>{t($ => $.audit.pagination, { total: viewer.result.total, page: Math.floor(viewer.offset / auditPageSize) + 1, pages: Math.max(1, Math.ceil(viewer.result.total / auditPageSize)) })}</StatusMessage>
              <div className="page-actions"><Button disabled={viewer.offset === 0} onClick={viewer.previous}>{t($ => $.audit.previous)}</Button><Button disabled={!viewer.hasNext} onClick={viewer.next}>{t($ => $.audit.next)}</Button></div>
            </div>
          </>}
        </div>
      </div>
      <Dialog open={Boolean(selected)} title={t($ => $.audit.details)} description={t($ => $.audit.detailDescription)} onClose={() => setSelected(null)} content={details ? <DetailsList items={details} /> : undefined}>
        <Button autoFocus onClick={() => setSelected(null)}>{t($ => $.audit.close)}</Button>
      </Dialog>
    </SectionCard>
  </div>
}
