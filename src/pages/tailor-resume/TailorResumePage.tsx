import { Button, Dialog, DialogHeader, Heading, Section, Selector, Stack, Step, Stepper, Text } from '@astryxdesign/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
    {state.error && <Text as="p" type="supporting" role="alert" className="error-message">{error(state.error)}</Text>}
    <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.resume.inputs)}</Heading></summary>
      <div className="feature-section-body">{t($ => $.resume.template) && <p>{t($ => $.resume.template)}</p>}<div className="resume-stack">
      <Selector label={t($ => $.resume.job)} isDisabled={active || state.busy} value={state.jobId} onChange={event => state.setJobId(event)}  options={[({ value: "", label: t($ => $.resume.chooseJob) }), ...(state.jobs.map(job => ({ value: job.id, label: (job.title) + (" · ") + (job.companyNameRaw) })))]} />
      <Selector label={t($ => $.resume.profile)} isDisabled={active || state.busy} value={state.profileId} onChange={event => state.setProfileId(event)}  options={[({ value: "", label: t($ => $.resume.chooseProfile) }), ...(state.profiles.map(profile => ({ value: profile.id, label: profile.title })))]} />
      <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button variant="primary" isDisabled={active || editing || state.busy || !state.jobId || !state.profileId} onClick={() => protectedAction(() => void state.start())} label={task ? t($ => $.resume.regenerate) : t($ => $.resume.start)} />
        {active && task?.owned && <Button isDisabled={state.busy} onClick={() => void state.cancel()} label={t($ => $.resume.cancel)} />}
        <Button onClick={() => void openPage('settings')} label={t($ => $.resume.settings)} /></Stack>
    </div></div></details></Section>
    {state.history.length > 0 && <Selector label={t($ => $.resume.history)} value={task?.run.id ?? ''} isDisabled={active || editing || state.busy} onChange={event => { const id = event; protectedAction(() => state.selectRun(id)) }}  options={[({ value: "", label: t($ => $.resume.history), disabled: true }), ...(state.history.map(({ run }) => ({ value: run.id, label: (run.createdAt) + (" · ") + (run.inputSnapshot.job.title) + (" · ") + (t($ => $.resume.statuses[run.state])) })))]} />}
    {task && <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.resume.progress)}</Heading></summary>
      <div className="feature-section-body"><div className="resume-stack">
      <Text as="p" type="supporting" role="status">{t($ => $.resume.statuses[task.run.state])}</Text>
      <Stepper activeStep={stages.findIndex(stage => stage.id === progress)} label={t($ => $.resume.progress)}>
        {stages.map(({ id, label }, index) => <Step key={id} step={index} label={label} status={artifact?.output.status === 'READY' ? 'success' : undefined} />)}
      </Stepper>
      {task.run.error && <Text as="p" type="supporting" role="alert" className="error-message">{error(task.run.error)}</Text>}
      {artifact && <><Text as="p" type="supporting" role="status">{t($ => $.resume.outputs[artifact.output.status])}</Text>
        {artifact.output.error && <Text as="p" type="supporting" role="alert" className="error-message">{error(artifact.output.error)}</Text>}
        <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">{artifact.output.status === 'READY' && <Button variant="primary" isDisabled={state.busy} onClick={() => void state.exportPdf()} label={t($ => $.resume.export)} />}
          {!active && <Button isDisabled={state.busy || dirty || editing} onClick={() => void state.retry()} label={t($ => $.resume.retryOutput)} />}</Stack>
        {state.saved && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.resume.saved)}</Text>}</>}
    </div></div></details></Section>}
    {task?.run.agentRunId && <ResumeTraceView key={task.run.id} runId={task.run.id} active={active} />}
    {state.preview && artifact?.id === state.preview.artifactId && artifact.revision === state.preview.revision && artifact.output.status === 'READY' && <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.resume.preview)}</Heading></summary>
      <div className="feature-section-body">{t($ => $.resume.pages, { count: state.preview.pages }) && <p>{t($ => $.resume.pages, { count: state.preview.pages })}</p>}<iframe className="resume-preview" title={t($ => $.resume.preview)} sandbox="" referrerPolicy="no-referrer" srcDoc={state.preview.html} /></div></details></Section>}
    {artifact && <section className="resume-stack" aria-label={t($ => $.resume.editTitle)}>
      <h2 className="profile-group-heading">{t($ => $.resume.editTitle)}</h2>
      <ResumeEditor key={artifact.id} value={state.draft?.id === artifact.id ? state.draft.content : artifact.content}
        disabled={active || state.busy} onEditing={setEditing} onChange={content => state.edit(artifact, content)} />
      <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
        <Button variant="primary" isDisabled={!dirty || editing || active || state.busy} onClick={() => void state.saveEdit()} label={t($ => $.resume.saveAndBuild)} />
        {dirty && <Button isDisabled={editing || state.busy} onClick={() => setDiscard({})} label={t($ => $.resume.discardEdit)} />}
      </Stack>
      {state.editSaved && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.resume.editSaved)}</Text>}
    </section>}
    <Dialog  isOpen={Boolean(discard)} onOpenChange={() => setDiscard(null)} aria-label={t($ => $.resume.discardEdit)} width={448} purpose="form">
      <DialogHeader title={t($ => $.resume.discardEdit)} subtitle={t($ => $.resume.discardEditHelp)} />
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
      <Button onClick={() => setDiscard(null)} label={t($ => $.profile.cancel)} />
      <Button variant="destructive" onClick={() => { state.discardEdit(); discard?.next?.(); setDiscard(null) }} label={t($ => $.resume.discardEdit)} />
    </Stack>
    </Dialog>
  </div></main>
}
