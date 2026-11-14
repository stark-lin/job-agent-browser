import { useCopyFeedback } from '../../shared/use-copy-feedback'
import { Button, Collapsible, Heading, MetadataList, MetadataListItem, Section, Stack, Text } from '@astryxdesign/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import { AgentTimelineItem } from '../../app/components/AgentTimelineItem'
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
  const clipboard = useCopyFeedback(trace?.run.eventSequence)
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
  return <Section className="feature-section" padding={0}><details onToggle={event => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open)
  }}  onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.resume.trace)}</Heading></summary>
      <div className="feature-section-body">
      <div className="resume-stack">
        {failed ? <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.resume.traceError)}</Text> : !trace ? <Text as="p" type="supporting" role="status">{t($ => $.app.loadingWorkspace)}</Text> : <>
          <MetadataList>{([
            { label: t($ => $.ask.guard.runId), value: trace.run.id },
            { label: t($ => $.ask.guard.runState), value: t($ => $.ask.itemStates[trace.run.state]) }
          ]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>
          <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button  label={clipboard.copied ? t($ => $.ask.copied) : t($ => $.resume.copyDiagnostics)}
        isDisabled={clipboard.copying || clipboard.copied} aria-busy={clipboard.copying} aria-live="polite" onClick={() => void clipboard.copy(copyDiagnostics)} /></Stack>
          {copyFailed && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.resume.copyDiagnosticsError)}</Text>}
          <Collapsible trigger={t($ => $.resume.cycles)} defaultIsOpen={false} chevronPosition="start">
            <MetadataList>{(trace.cycles.map(cycle => ({ label: String(cycle.index), value: [cycle.status, cycle.reason, cycle.modelRequestOrdinal].filter(Boolean).join(' · ') }))).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>
          </Collapsible>
          <Collapsible trigger={t($ => $.resume.requests)} defaultIsOpen={false} chevronPosition="start">
            <MetadataList>{(trace.requests.map(request => ({ label: String(request.ordinal), value: `${request.modelId} · ${request.purpose} · ${request.verification}` }))).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>
          </Collapsible>
          {trace.items.map(item => <AgentTimelineItem key={item.id} item={item} run={trace.run} />)}
        </>}
      </div>
  </div></details></Section>
}
