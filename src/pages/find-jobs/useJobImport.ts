import { useEffect, useRef, useState } from 'react'
import { useServices } from '../../app/providers'
import { allowsParallelImport, type AISettings } from '../../shared/ai'
import type { ImportMode, ImportGroupProgress } from '../../shared/import'
import type { JobImportDraft } from '../../domain/job/job.extractor'
import type { JobInput, SourceInput } from '../../domain/job/job.types'
import type { JobImportEvent } from '../../platform/electron/job-import-contract'

export function useJobImport(onReady: (draft: JobImportDraft) => void) {
  const { data, jobImport } = useServices()
  const [settings, setSettings] = useState<AISettings | null>(null), [mode, setMode] = useState<ImportMode>('single')
  const [groups, setGroups] = useState<ImportGroupProgress[]>([]), [retryable, setRetryable] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'reading' | 'parsing'>('idle'), [error, setError] = useState('')
  const draftTask = useRef('')
  const task = useRef(''), starting = useRef(false), running = useRef(false), early = useRef<JobImportEvent[]>([])
  const alive = useRef(true), generation = useRef(0), ready = useRef(onReady)
  ready.current = onReady
  const eventRef = useRef<(event: JobImportEvent) => void>(() => {})
  eventRef.current = event => {
    if (!alive.current) return
    if (!task.current) { if (starting.current) early.current.push(event); return }
    if (event.taskId !== task.current) return
    if (event.type === 'phase') setPhase(event.phase)
    else if (event.type === 'progress') setGroups(event.groups)
    else {
      running.current = false; setPhase('idle')
      if (event.type === 'ready') { draftTask.current = event.taskId; task.current = ''; setRetryable(false); ready.current(event.draft) }
      else if (event.type === 'failed') { setError(event.error); setRetryable(Boolean(event.retryable)); if (!event.retryable) task.current = '' }
      else { task.current = ''; setRetryable(false) }
    }
  }
  useEffect(() => {
    alive.current = true
    let disposed = false
    void data.settings.get({}).then(result => { if (!disposed && result.ok) setSettings(result.value.ai) }).catch(() => {})
    const unsubscribe = jobImport.onEvent(event => eventRef.current(event))
    return () => {
      disposed = true; alive.current = false; generation.current++; unsubscribe()
      if (task.current) void jobImport.cancel({ taskId: task.current }).catch(() => {})
      if (draftTask.current) void jobImport.cancel({ taskId: draftTask.current }).catch(() => {})
      task.current = ''; starting.current = false; early.current = []
    }
  }, [data, jobImport])
  async function start(source: { url: string } | { text: string } | { fileId: string }, retry = false) {
    if (starting.current || running.current || !settings?.default) return
    const previousTask = task.current, version = ++generation.current
    task.current = ''; starting.current = true; running.current = true; early.current = []
    setPhase(retry ? 'parsing' : 'reading'); setError(''); setRetryable(false)
    if (!retry) setGroups([])
    try {
      const result = retry ? await jobImport.retry({ taskId: previousTask })
        : await jobImport.start({ ...source, choice: settings.default, mode: allowsParallelImport(settings, settings.default) ? mode : 'single' })
      if (!alive.current || version !== generation.current) {
        if (result.ok) void jobImport.cancel(result.value).catch(() => {})
        return
      }
      starting.current = false
      if (!result.ok) { running.current = false; setPhase('idle'); setError(result.error); early.current = []; return }
      task.current = result.value.taskId
      for (const message of early.current.splice(0)) eventRef.current(message)
    } catch { if (alive.current && version === generation.current) { starting.current = false; running.current = false; setPhase('idle'); setError('JOB_FETCH_FAILED') } }
  }
  function cancel() {
    generation.current++; starting.current = false; running.current = false; early.current = []
    const id = task.current; task.current = ''; setPhase('idle'); setRetryable(false); setGroups([])
    if (id) void jobImport.cancel({ taskId: id }).catch(() => {})
  }
  function clearError() { setError(''); if (!running.current) { cancel(); setGroups([]) } }
  const choice = settings?.default, provider = settings?.providers.find(provider => provider.id === choice?.providerId)
  const save = (input: { details: JobInput; source?: SourceInput | null }) => draftTask.current
    ? jobImport.save({ taskId: draftTask.current, ...input }) : data.jobs.saveJob(input)
  return { start, save, selectPdf: jobImport.selectPdf, cancel, clearError, phase, error, groups, retryable, mode, setMode, parallelAllowed: allowsParallelImport(settings, choice ?? null),
    configured: Boolean(choice), provider: provider?.name ?? '', model: choice?.modelId ?? '' }
}
