import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import { AgentTimelineItem } from '../../app/components/AgentTimelineItem'
import { ActionRow, Collapsible, CopyButton, DetailsList, SectionCard, StatusMessage } from '../../shared/ui'
import type { ResumeTrace } from '../../platform/electron/resume-contract'
import type { AgentRunEvent } from '../../domain/chat/chat.types'
import { applyResumeTraceEvent } from './resume-trace'

export function ResumeTraceView({ runId, active }: { runId: string; active: boolean }) {
  const { t } = useTranslation(), { resume } = useServices()
  const [open, setOpen] = useState(false), [trace, setTrace] = useState<ResumeTrace | null>(null), [failed, setFailed] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  useEffect(() => {
    if (!open) return
    let current = true, loading = false
    let snapshot: ResumeTrace | null = null, queued: AgentRunEvent<string | null>[] = []
    async function refresh() {
      if (loading) return
      loading = true
      try {
        const result = await resume.getTrace({ runId })
        if (!current) return
        setFailed(!result.ok)
        if (result.ok && result.value) {
          snapshot = snapshot && snapshot.run.eventSequence > result.value.run.eventSequence
            ? { ...result.value, run: snapshot.run, items: snapshot.items } : result.value
          const pending = queued; queued = []
          for (const event of pending) {
            const next = applyResumeTraceEvent(snapshot, event)
            if (!next) { queued.push(event); continue }
            snapshot = next
          }
          setTrace(snapshot)
        }
      } catch { if (current) setFailed(true) }
      finally { loading = false }
    }
    const unsubscribe = resume.onEvent(event => {
      if (event.runId !== runId || !event.trace) return
      if (!loading && snapshot) {
        const next = applyResumeTraceEvent(snapshot, event.trace)
        if (next) { snapshot = next; setTrace(next); return }
      }
      queued = [...queued, event.trace].slice(-2048)
      void refresh()
    })
    void refresh()
    // Keep persisted cycle/request diagnostics and externally owned runs synchronized.
    const timer = active ? setInterval(() => void refresh(), 1000) : undefined
    return () => { current = false; unsubscribe(); clearInterval(timer) }
  }, [open, active, runId, resume])
  async function copyDiagnostics() {
    setCopyFailed(false)
    try {
      const [latest, task] = await Promise.all([resume.getTrace({ runId }), resume.getTask({ runId })])
      if (!latest.ok || !latest.value || !task.ok || !task.value) throw new Error('TRACE_UNAVAILABLE')
      const artifact = task.value.artifact
      await navigator.clipboard.writeText(JSON.stringify({ version: 1, generationRun: task.value.run,
        artifact: artifact ? { id: artifact.id, revision: artifact.revision, output: artifact.output, outputFiles: artifact.outputFiles } : null,
        trace: latest.value }, null, 2))
      return true
    } catch { setCopyFailed(true); return false }
  }
  return <SectionCard title={t($ => $.resume.trace)} defaultCollapsed onToggle={event => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open)
  }}>
      <div className="resume-stack">
        {failed ? <StatusMessage tone="error">{t($ => $.resume.traceError)}</StatusMessage> : !trace ? <StatusMessage>{t($ => $.app.loadingWorkspace)}</StatusMessage> : <>
          <DetailsList items={[
            { label: t($ => $.ask.guard.runId), value: trace.run.id },
            { label: t($ => $.ask.guard.runState), value: t($ => $.ask.itemStates[trace.run.state]) }
          ]} />
          <ActionRow><CopyButton resetKey={trace.run.eventSequence} copyLabel={t($ => $.resume.copyDiagnostics)} copiedLabel={t($ => $.ask.copied)} onCopy={copyDiagnostics} /></ActionRow>
          {copyFailed && <StatusMessage tone="error">{t($ => $.resume.copyDiagnosticsError)}</StatusMessage>}
          <Collapsible label={t($ => $.resume.cycles)}>
            <DetailsList items={trace.cycles.map(cycle => ({ label: String(cycle.index), value: [cycle.status, cycle.reason, cycle.modelRequestOrdinal].filter(Boolean).join(' · ') }))} />
          </Collapsible>
          <Collapsible label={t($ => $.resume.requests)}>
            <DetailsList items={trace.requests.map(request => ({ label: String(request.ordinal), value: `${request.modelId} · ${request.purpose} · ${request.verification}` }))} />
          </Collapsible>
          {trace.items.map(item => <AgentTimelineItem key={item.id} item={item} run={trace.run} />)}
        </>}
      </div>
  </SectionCard>
}
