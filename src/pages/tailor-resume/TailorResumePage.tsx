import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionRow, Button, Dialog, DocumentPreview, FormField, SectionCard, Select, StageProgress, StatusMessage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'
import type { en } from '../../shared/i18n/locales/en'
import { useTailorResume } from './hooks/useTailorResume'
import { ResumeTraceView } from './ResumeTraceView'
import { ResumeEditor } from './ResumeEditor'
import { useUnsavedGuard } from '../../app/navigation/useUnsavedGuard'
import './resume.css'

export function TailorResumePage() {
  const { t } = useTranslation(), { openPage } = useNavigation(), state = useTailorResume()
  const task = state.task, active = Boolean(task?.active), artifact = task?.artifact
  const [editing, setEditing] = useState(false), [discard, setDiscard] = useState<{ next?: () => void } | null>(null)
  const dirty = Boolean(state.draft)
  useUnsavedGuard(dirty || editing)
  const protectedAction = (action: () => void) => { if (dirty) setDiscard({ next: action }); else action() }
  const error = (code: string) => t($ => $.resume.errors[code as keyof typeof en.resume.errors], { defaultValue: t($ => $.ai.errors[code as keyof typeof en.ai.errors], { defaultValue: t($ => $.ask.errors[code as keyof typeof en.ask.errors], { defaultValue: t($ => $.errors.actionFailed) }) }) })
  const steps = ['COPYING', 'REWRITING', 'VALIDATING', 'PUBLISHING', 'OUTPUT'] as const
  const stages = steps.map(id => ({ id, label: t($ => $.resume.stages[id]) }))
  const current = task?.run.state
  const progress = current === 'PUBLISHED' ? 'OUTPUT' : current && steps.some(step => step === current) ? current
    : steps[Math.max(0, Math.min(3, (task?.run.stateVersion ?? 0) - 2))]
  return <main className="resume-page" aria-label={t($ => $.navigation.pages.resume)}><div className="resume-content">
    {state.error && <StatusMessage tone="error">{error(state.error)}</StatusMessage>}
    <SectionCard title={t($ => $.resume.inputs)} description={t($ => $.resume.template)}><div className="resume-stack">
      <FormField label={t($ => $.resume.job)}>{props => <Select {...props} disabled={active || state.busy} value={state.jobId} onChange={event => state.setJobId(event.target.value)}><option value="">{t($ => $.resume.chooseJob)}</option>{state.jobs.map(job => <option key={job.id} value={job.id}>{job.title} · {job.companyNameRaw}</option>)}</Select>}</FormField>
      <FormField label={t($ => $.resume.profile)}>{props => <Select {...props} disabled={active || state.busy} value={state.profileId} onChange={event => state.setProfileId(event.target.value)}><option value="">{t($ => $.resume.chooseProfile)}</option>{state.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.title}</option>)}</Select>}</FormField>
      <ActionRow><Button variant="primary" disabled={active || editing || state.busy || !state.jobId || !state.profileId} onClick={() => protectedAction(() => void state.start())}>{task ? t($ => $.resume.regenerate) : t($ => $.resume.start)}</Button>
        {active && task?.owned && <Button disabled={state.busy} onClick={() => void state.cancel()}>{t($ => $.resume.cancel)}</Button>}
        <Button onClick={() => void openPage('settings')}>{t($ => $.resume.settings)}</Button></ActionRow>
    </div></SectionCard>
    {state.history.length > 0 && <FormField label={t($ => $.resume.history)}>{props => <Select {...props} value={task?.run.id ?? ''} disabled={active || editing || state.busy} onChange={event => { const id = event.target.value; protectedAction(() => state.selectRun(id)) }}><option value="" disabled>{t($ => $.resume.history)}</option>{state.history.map(({ run }) => <option key={run.id} value={run.id}>{run.createdAt} · {run.inputSnapshot.job.title} · {t($ => $.resume.statuses[run.state])}</option>)}</Select>}</FormField>}
    {task && <SectionCard title={t($ => $.resume.progress)}><div className="resume-stack">
      <StatusMessage tone={task.run.state === 'FAILED' ? 'error' : task.run.state === 'PUBLISHED' ? 'success' : 'neutral'}>{t($ => $.resume.statuses[task.run.state])}</StatusMessage>
      <StageProgress stages={stages} current={progress} complete={artifact?.output.status === 'READY'} label={t($ => $.resume.progress)} />
      {task.run.error && <StatusMessage tone="error">{error(task.run.error)}</StatusMessage>}
      {artifact && <><StatusMessage>{t($ => $.resume.outputs[artifact.output.status])}</StatusMessage>
        {artifact.output.error && <StatusMessage tone="error">{error(artifact.output.error)}</StatusMessage>}
        <ActionRow>{artifact.output.status === 'READY' && <Button variant="primary" disabled={state.busy} onClick={() => void state.exportPdf()}>{t($ => $.resume.export)}</Button>}
          {!active && <Button disabled={state.busy || dirty || editing} onClick={() => void state.retry()}>{t($ => $.resume.retryOutput)}</Button>}</ActionRow>
        {state.saved && <StatusMessage tone="success">{t($ => $.resume.saved)}</StatusMessage>}</>}
    </div></SectionCard>}
    {task?.run.agentRunId && <ResumeTraceView key={task.run.id} runId={task.run.id} active={active} />}
    {state.preview && artifact?.id === state.preview.artifactId && artifact.revision === state.preview.revision && artifact.output.status === 'READY' && <SectionCard title={t($ => $.resume.preview)} description={t($ => $.resume.pages, { count: state.preview.pages })}><DocumentPreview title={t($ => $.resume.preview)} html={state.preview.html} /></SectionCard>}
    {artifact && <section className="resume-stack" aria-label={t($ => $.resume.editTitle)}>
      <h2 className="profile-group-heading">{t($ => $.resume.editTitle)}</h2>
      <ResumeEditor key={artifact.id} value={state.draft?.id === artifact.id ? state.draft.content : artifact.content}
        disabled={active || state.busy} onEditing={setEditing} onChange={content => state.edit(artifact, content)} />
      <ActionRow>
        <Button variant="primary" disabled={!dirty || editing || active || state.busy} onClick={() => void state.saveEdit()}>{t($ => $.resume.saveAndBuild)}</Button>
        {dirty && <Button disabled={editing || state.busy} onClick={() => setDiscard({})}>{t($ => $.resume.discardEdit)}</Button>}
      </ActionRow>
      {state.editSaved && <StatusMessage tone="success">{t($ => $.resume.editSaved)}</StatusMessage>}
    </section>}
    <Dialog open={Boolean(discard)} title={t($ => $.resume.discardEdit)} description={t($ => $.resume.discardEditHelp)} onClose={() => setDiscard(null)}>
      <Button onClick={() => setDiscard(null)}>{t($ => $.profile.cancel)}</Button>
      <Button variant="danger" onClick={() => { state.discardEdit(); discard?.next?.(); setDiscard(null) }}>{t($ => $.resume.discardEdit)}</Button>
    </Dialog>
  </div></main>
}
