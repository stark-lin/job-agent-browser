import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormField, PageHeading, SectionCard, StatusMessage, TextInput } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'
import { useServices } from '../../app/providers'
import { useUnsavedGuard } from '../../app/navigation/useUnsavedGuard'
import { jobDetails, sourceDetails } from '../../domain/job/job.validation'
import type { SourceDetails } from '../../domain/job/job.types'
import { en } from '../../shared/i18n/locales/en'
import { JobFields } from './JobFields'
import { emptyJob, fillEmptyJob } from './job-form'
import { useJobImport } from './useJobImport'
import './job.css'

export function AddJobPage() {
  const { t } = useTranslation(), { data, context, navigation } = useServices(), { openPage, active } = useNavigation()
  const [details, setDetails] = useState(emptyJob), [url, setUrl] = useState(''), [source, setSource] = useState<SourceDetails | null>(null)
  const [saving, setSaving] = useState(false), [saved, setSaved] = useState(false), [notice, setNotice] = useState(false), [error, setError] = useState('')
  const lock = useRef(false), alive = useRef(true)
  const importer = useJobImport(draft => { setDetails(current => fillEmptyJob(current, draft.details)); setSource(draft.source); setNotice(true) })
  const busy = importer.phase !== 'idle', dirty = !saved && (busy || Boolean(url) || JSON.stringify(details) !== JSON.stringify(emptyJob()))
  useUnsavedGuard(dirty)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const errorText = (code: string) => t($ => $.jobs.errors[code as keyof typeof en.jobs.errors], { defaultValue: t($ => $.ai.errors[code as keyof typeof en.ai.errors], { defaultValue: t($ => $.errors.actionFailed) }) })
  async function save() {
    if (lock.current || busy || saved) return
    let input
    try {
      input = { details: jobDetails({ ...details, title: details.title.trim(), companyNameRaw: details.companyNameRaw.trim() }),
        source: url.trim() ? sourceDetails(source?.url === url.trim() ? source : { url: url.trim() }) : null }
      if (input.details.salary && input.details.salary.min !== null && input.details.salary.max !== null && input.details.salary.min > input.details.salary.max) throw new Error('INVALID_INPUT')
    } catch { setError('INVALID_INPUT'); return }
    lock.current = true; setSaving(true); setError('')
    let committed = false
    try {
      const result = await data.jobs.saveJob(input)
      if (!alive.current) return
      if (!result.ok) { setError(result.error); return }
      committed = true; context.setReferences({ jobId: result.value.id }); setSaved(true)
      // Clear Main's draft registration before navigation; a delayed React effect must not prompt after commit.
      if (active) await navigation.api.setUnsaved(false, { tabId: active.id, targetId: active.targetId })
      await openPage('applications')
    } catch { if (alive.current) setError(committed ? 'JOB_SAVED_NAV_FAILED' : 'STORAGE_UNAVAILABLE') }
    finally { lock.current = false; if (alive.current) setSaving(false) }
  }
  return <main className="job-page"><div className="job-content">
    <div className="page-actions"><Button variant="ghost" onClick={() => void openPage('home')}>{t($ => $.navigation.goHome)}</Button></div>
    <PageHeading title={t($ => $.navigation.pages.find)} description={t($ => $.jobs.subtitle)} />
    <SectionCard title={t($ => $.jobs.importTitle)} description={t($ => $.jobs.importHelp)}><div className="job-stack">
      <FormField label={t($ => $.jobs.url)}>{props => <TextInput {...props} name="jobUrl" type="url" value={url} maxLength={4096} disabled={saving || busy || saved} onChange={event => { setUrl(event.target.value); setSource(null); setNotice(false); setError(''); importer.clearError() }} />}</FormField>
      {importer.configured ? <StatusMessage>{t($ => $.jobs.selectedModel, { provider: importer.provider, model: importer.model })}</StatusMessage> : <StatusMessage>{t($ => $.jobs.noAI)}</StatusMessage>}
      <div className="job-actions"><Button disabled={!url.trim() || !importer.configured || saving || busy || saved} onClick={() => { setNotice(false); setError(''); void importer.start(url.trim()) }}>{t($ => $.jobs.parse)}</Button>
        {busy && <Button onClick={importer.cancel}>{t($ => $.jobs.cancelParse)}</Button>}
        {!importer.configured && <Button onClick={() => void openPage('settings')}>{t($ => $.navigation.openSettings)}</Button>}
      </div>
      {busy && <StatusMessage>{t($ => $.jobs[importer.phase === 'reading' ? 'reading' : 'parsing'])}</StatusMessage>}
      {importer.error && <StatusMessage tone="error">{errorText(importer.error)}</StatusMessage>}
      {notice && <StatusMessage tone="success">{t($ => $.jobs.parsed)}</StatusMessage>}
    </div></SectionCard>
    {error && <StatusMessage tone="error">{errorText(error)}</StatusMessage>}
    <form className="job-stack" onSubmit={event => { event.preventDefault(); void save() }}>
      <JobFields value={details} disabled={saving || saved} onChange={value => { setDetails(value); setError('') }} />
      <StatusMessage>{t($ => $.jobs.initialStatus)}</StatusMessage>
      <div className="job-actions"><Button type="submit" variant="primary" disabled={saving || busy || saved}>{t($ => $.jobs[saving ? 'saving' : 'save'])}</Button>
        {saved && <Button onClick={() => void openPage('applications')}>{t($ => $.navigation.pages.applications)}</Button>}</div>
    </form>
  </div></main>
}
