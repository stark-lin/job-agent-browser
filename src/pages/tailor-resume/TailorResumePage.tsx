import { useTranslation } from 'react-i18next'
import { Button, DetailsList, DocumentPreview, FormField, PageHeading, SectionCard, Select, StageProgress, StatusMessage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'
import type { en } from '../../shared/i18n/locales/en'
import { statements } from '../../domain/resume/document'
import { useTailorResume } from './hooks/useTailorResume'
import './resume.css'

export function TailorResumePage() {
  const { t } = useTranslation(), { openPage } = useNavigation(), state = useTailorResume()
  const task = state.task, active = Boolean(task?.active), artifact = task?.artifact
  const error = (code: string) => t($ => $.resume.errors[code as keyof typeof en.resume.errors], { defaultValue: t($ => $.ai.errors[code as keyof typeof en.ai.errors], { defaultValue: t($ => $.errors.actionFailed) }) })
  const stages = (['score', 'gate', 'select', 'draft', 'validate-draft', 'polish', 'validate-polish', 'publish', 'output'] as const).map(id => ({ id, label: t($ => $.resume.stages[id]) }))
  return <main className="resume-page"><div className="resume-content">
    <div className="page-actions"><Button variant="ghost" onClick={() => void openPage('home')}>{t($ => $.navigation.goHome)}</Button></div>
    <PageHeading title={t($ => $.navigation.pages.resume)} description={t($ => $.resume.subtitle)} />
    {state.error && <StatusMessage tone="error">{error(state.error)}</StatusMessage>}
    <SectionCard title={t($ => $.resume.inputs)} description={t($ => $.resume.template)}><div className="resume-stack">
      <FormField label={t($ => $.resume.job)}>{props => <Select {...props} disabled={active || state.busy} value={state.jobId} onChange={event => state.setJobId(event.target.value)}><option value="">{t($ => $.resume.chooseJob)}</option>{state.jobs.map(job => <option key={job.id} value={job.id}>{job.title} · {job.companyNameRaw}</option>)}</Select>}</FormField>
      <FormField label={t($ => $.resume.profile)}>{props => <Select {...props} disabled={active || state.busy} value={state.profileId} onChange={event => state.setProfileId(event.target.value)}><option value="">{t($ => $.resume.chooseProfile)}</option>{state.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</Select>}</FormField>
      <div className="resume-actions"><Button variant="primary" disabled={active || state.busy || !state.jobId || !state.profileId} onClick={() => void state.start()}>{task ? t($ => $.resume.regenerate) : t($ => $.resume.start)}</Button>
        {active && task?.owned && <Button disabled={state.busy} onClick={() => void state.cancel()}>{t($ => $.resume.cancel)}</Button>}
        <Button onClick={() => void openPage('settings')}>{t($ => $.resume.settings)}</Button></div>
    </div></SectionCard>
    {state.history.length > 0 && <FormField label={t($ => $.resume.history)}>{props => <Select {...props} value={task?.run.id ?? ''} disabled={active || state.busy} onChange={event => state.selectRun(event.target.value)}><option value="" disabled>{t($ => $.resume.history)}</option>{state.history.map(({ run }) => <option key={run.id} value={run.id}>{run.createdAt} · {run.inputSnapshot.job.title} · {t($ => $.resume.statuses[run.status])}</option>)}</Select>}</FormField>}
    {task && <SectionCard title={t($ => $.resume.progress)}><div className="resume-stack">
      <StatusMessage tone={task.run.status === 'FAILED' ? 'error' : task.run.status === 'SUCCEEDED' ? 'success' : 'neutral'}>{t($ => $.resume.statuses[task.run.status])}</StatusMessage>
      <StageProgress stages={stages} current={task.run.stage} complete={artifact?.output.status === 'READY'} label={t($ => $.resume.progress)} />
      {task.run.error && <StatusMessage tone="error">{error(task.run.error)}</StatusMessage>}
      {task.run.gate && !task.run.gate.passed && <DetailsList items={[{ label: t($ => $.resume.reason), value: task.run.gate.reason }, { label: t($ => $.resume.missing), value: task.run.gate.missingRequirements.join(' · ') }]} />}
      {artifact && <><StatusMessage>{t($ => $.resume.outputs[artifact.output.status])}</StatusMessage>
        {artifact.output.error && <StatusMessage tone="error">{error(artifact.output.error)}</StatusMessage>}
        <div className="resume-actions">{artifact.output.status === 'READY' && <Button variant="primary" disabled={state.busy} onClick={() => void state.exportPdf()}>{t($ => $.resume.export)}</Button>}
          {!active && <Button disabled={state.busy} onClick={() => void state.retry()}>{t($ => $.resume.retryOutput)}</Button>}</div>
        {state.saved && <StatusMessage tone="success">{t($ => $.resume.saved)}</StatusMessage>}</>}
    </div></SectionCard>}
    {state.preview && <SectionCard title={t($ => $.resume.preview)} description={t($ => $.resume.pages, { count: state.preview.pages })}><DocumentPreview title={t($ => $.resume.preview)} html={state.preview.html} /></SectionCard>}
    {task && artifact && <SectionCard title={t($ => $.resume.sources)}><div className="resume-stack">{statements(artifact.content).map(block => <SectionCard key={block.id} title={block.text}><DetailsList items={block.factIds.map(id => ({ label: id, value: task.run.inputSnapshot.facts.find(fact => fact.id === id)?.content ?? id }))} /></SectionCard>)}</div></SectionCard>}
  </div></main>
}
