import { Button, Heading, Section, Selector, Stack, Text, TextArea, TextInput } from '@astryxdesign/core'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigation } from '../../app/navigation/navigate'
import { useServices } from '../../app/providers'
import { useUnsavedGuard } from '../../app/navigation/useUnsavedGuard'
import { jobDetails } from '../../domain/job/job.validation'
import type { SourceDetails } from '../../domain/job/job.types'
import { en } from '../../shared/i18n/locales/en'
import { JobFields } from './JobFields'
import { emptyJob, fillEmptyJob, jobFormSource } from './job-form'
import { useWebSelection } from '../../app/navigation/useWebSelection'
import type { WebSelection } from '../../shared/browser-selection'
import { useJobImport } from './useJobImport'
import './job.css'

export function AddJobPage() {
  const { t } = useTranslation(), { context, navigation } = useServices(), { openPage, active } = useNavigation()
  const [details, setDetails] = useState(emptyJob), [url, setUrl] = useState(''), [source, setSource] = useState<SourceDetails | null>(null)
  const [sourceKind, setSourceKind] = useState<'url' | 'text' | 'pdf'>('url'), [text, setText] = useState(''), [pdf, setPdf] = useState<{ fileId: string; bytes: number } | null>(null)
  const [saving, setSaving] = useState(false), [saved, setSaved] = useState(false), [notice, setNotice] = useState(false), [error, setError] = useState('')
  const [webSource, setWebSource] = useState<WebSelection['source'] | null>(null)
  const selection = useWebSelection('job-import', selected => {
    setSourceKind('text'); setText(selected.text); setWebSource(selected.source)
  })
  const lock = useRef(false), alive = useRef(true)
  const importer = useJobImport(draft => { setDetails(current => fillEmptyJob(current, draft.details)); setSource(draft.source); setNotice(true) })
  const busy = importer.phase !== 'idle', dirty = !saved && (busy || Boolean(url) || Boolean(text) || Boolean(pdf) || JSON.stringify(details) !== JSON.stringify(emptyJob()))
  useUnsavedGuard(dirty)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const errorText = (code: string) => t($ => $.jobs.errors[code as keyof typeof en.jobs.errors], { defaultValue: t($ => $.ai.errors[code as keyof typeof en.ai.errors], { defaultValue: t($ => $.profile.errors[code as keyof typeof en.profile.errors], { defaultValue: t($ => $.errors.actionFailed) }) }) })
  async function save() {
    if (lock.current || busy || saved) return
    let input
    try {
      input = { details: jobDetails({ ...details, title: details.title.trim(), companyNameRaw: details.companyNameRaw.trim() }),
        source: jobFormSource(sourceKind, url, source, webSource, text) }
      if (input.details.salary && input.details.salary.min !== null && input.details.salary.max !== null && input.details.salary.min > input.details.salary.max) throw new Error('INVALID_INPUT')
    } catch { setError('INVALID_INPUT'); return }
    lock.current = true; setSaving(true); setError('')
    let committed = false
    try {
      const result = await importer.save(input)
      if (!alive.current) return
      if (!result.ok) { setError(result.error); return }
      committed = true; context.setReferences({ jobId: result.value.id }); setSaved(true)
      // Clear Main's draft registration before navigation; a delayed React effect must not prompt after commit.
      if (active) await navigation.api.setUnsaved(false, { tabId: active.id, targetId: active.targetId })
      await openPage('applications')
    } catch { if (alive.current) setError(committed ? 'JOB_SAVED_NAV_FAILED' : 'STORAGE_UNAVAILABLE') }
    finally { lock.current = false; if (alive.current) setSaving(false) }
  }
  return <main className="job-page" aria-label={t($ => $.navigation.pages.find)}><div className="job-content">
    <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.jobs.importTitle)}</Heading></summary>
      <div className="feature-section-body">{t($ => $.jobs.importHelp) && <p>{t($ => $.jobs.importHelp)}</p>}<div className="job-stack">
      {selection.error && <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.selection[selection.error!])}</Text><Button onClick={selection.retry} label={t($ => $.selection.retry)} /></Stack>}
      {webSource && <Text as="p" type="supporting" role="status">{t($ => $.selection.source)}: {webSource.title} · {webSource.url}</Text>}
      <Selector label={t($ => $.jobs.inputKind)} htmlName="captureSource" value={sourceKind} isDisabled={busy || saving || saved} onChange={event => { if (event !== 'url' && event !== 'text' && event !== 'pdf') return; setSourceKind(event); setSource(null); setWebSource(null); importer.clearError() }}  options={[({ value: "url", label: t($ => $.jobs.url) }), ({ value: "text", label: t($ => $.jobs.pastedJD) }), ({ value: "pdf", label: t($ => $.jobs.pdf) })]} />
      {sourceKind === 'url' && <TextInput label={t($ => $.jobs.url)} htmlName="jobUrl" type="url" value={url} ref={input => { if (input) { input.maxLength = 4096 } }} isDisabled={saving || busy || saved} onChange={event => { setUrl(event); setSource(null); setNotice(false); setError(''); importer.clearError() }} />}
      {sourceKind === 'text' && <TextArea label={t($ => $.jobs.pastedJD)} htmlName="jobText" value={text} ref={input => { if (input) input.maxLength = 60000 }} isDisabled={busy || saving || saved} onChange={event => { setText(event); importer.clearError() }} />}
      {sourceKind === 'pdf' && <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">{pdf && <Text as="p" type="supporting" role="status">{t($ => $.jobs.pdfSelected, { bytes: pdf.bytes })}</Text>}
        <Button isDisabled={busy || saving || saved} onClick={() => { void importer.selectPdf().then(result => { if (result.ok) setPdf(result.value); else setError(result.error) }).catch(() => setError('PDF_INVALID')) }} label={t($ => $.jobs.selectPdf)} /></Stack>}

      {importer.configured ? <Text as="p" type="supporting" role="status">{t($ => $.jobs.selectedModel, { provider: importer.provider, model: importer.model })}</Text> : <Text as="p" type="supporting" role="status">{t($ => $.jobs.noAI)}</Text>}
      <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button isDisabled={!(sourceKind === 'url' ? url.trim() : sourceKind === 'text' ? text.trim() : pdf) || !importer.configured || saving || busy || saved} onClick={() => { setNotice(false); setError(''); void importer.start(sourceKind === 'url' ? { url: url.trim() } : sourceKind === 'text' ? { text } : { fileId: pdf!.fileId }) }} label={t($ => $.jobs.parse)} />
        {importer.retryable && <Button isDisabled={busy || saving || saved} onClick={() => void importer.start()} label={t($ => $.profile.parseAgain)} />}
        {busy && <Button onClick={importer.cancel} label={t($ => $.jobs.cancelParse)} />}
        {!importer.configured && <Button onClick={() => void openPage('settings')} label={t($ => $.navigation.openSettings)} />}
      </Stack>
      {busy && <Text as="p" type="supporting" role="status">{t($ => $.jobs[importer.phase === 'reading' ? 'reading' : 'parsing'])}</Text>}
      {importer.error && <Text as="p" type="supporting" role="alert" className="error-message">{errorText(importer.error)}</Text>}
      {notice && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.jobs.parsed)}</Text>}
    </div></div></details></Section>
    {error && <Text as="p" type="supporting" role="alert" className="error-message">{errorText(error)}</Text>}
    <form className="job-stack" onSubmit={event => { event.preventDefault(); void save() }}>
      <JobFields value={details} disabled={saving || saved} onChange={value => { setDetails(value); setError('') }} />
      <Text as="p" type="supporting" role="status">{t($ => $.jobs.initialStatus)}</Text>
      <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button type="submit" variant="primary" isDisabled={saving || busy || saved} label={t($ => $.jobs[saving ? 'saving' : 'save'])} />
        {saved && <Button onClick={() => void openPage('applications')} label={t($ => $.navigation.pages.applications)} />}</Stack>
    </form>
  </div></main>
}
