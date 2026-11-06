import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import { AgentTimelineItem } from '../../app/components/AgentTimelineItem'
import { Button, Collapsible, DetailsList, Drawer, StatusMessage } from '../../shared/ui'
import type { ResumeTrace } from '../../platform/electron/resume-contract'

export function ResumeTraceView({ runId, active }: { runId: string; active: boolean }) {
  const { t } = useTranslation(), { resume } = useServices()
  const [open, setOpen] = useState(false), [trace, setTrace] = useState<ResumeTrace | null>(null), [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!open) return
    let current = true, loading = false
    async function refresh() {
      if (loading) return
      loading = true
      try {
        const result = await resume.getTrace({ runId })
        if (current) { setFailed(!result.ok); if (result.ok) setTrace(result.value) }
      } catch { if (current) setFailed(true) }
      finally { loading = false }
    }
    void refresh()
    const timer = active ? setInterval(() => void refresh(), 1000) : undefined
    return () => { current = false; clearInterval(timer) }
  }, [open, active, runId, resume])
  return <>
    <Button aria-expanded={open} onClick={() => setOpen(true)}>{t($ => $.resume.trace)}</Button>
    <Drawer open={open} title={t($ => $.resume.trace)} closeLabel={t($ => $.ask.close)} onClose={() => setOpen(false)}>
      <div className="resume-stack">
        {failed ? <StatusMessage tone="error">{t($ => $.resume.traceError)}</StatusMessage> : !trace ? <StatusMessage>{t($ => $.app.loadingWorkspace)}</StatusMessage> : <>
          <DetailsList items={[
            { label: t($ => $.ask.guard.runId), value: trace.run.id },
            { label: t($ => $.ask.guard.runState), value: t($ => $.ask.itemStates[trace.run.state]) }
          ]} />
          <Collapsible label={t($ => $.resume.cycles)}>
            <DetailsList items={trace.cycles.map(cycle => ({ label: String(cycle.index), value: [cycle.status, cycle.reason, cycle.modelRequestOrdinal].filter(Boolean).join(' · ') }))} />
          </Collapsible>
          <Collapsible label={t($ => $.resume.requests)}>
            <DetailsList items={trace.requests.map(request => ({ label: String(request.ordinal), value: `${request.modelId} · ${request.purpose} · ${request.verification}` }))} />
          </Collapsible>
          {trace.items.map(item => <AgentTimelineItem key={item.id} item={item} run={trace.run} />)}
        </>}
      </div>
    </Drawer>
  </>
}
