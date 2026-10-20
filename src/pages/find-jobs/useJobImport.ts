import { useEffect, useRef, useState } from 'react'
import { useServices } from '../../app/providers'
import type { AISettings } from '../../shared/ai'
import type { JobImportDraft } from '../../domain/job/job.extractor'
import type { JobImportEvent } from '../../platform/electron/job-import-contract'

export function useJobImport(onReady: (draft: JobImportDraft) => void) {
  const { data, jobImport } = useServices()
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [phase, setPhase] = useState<'idle' | 'reading' | 'parsing'>('idle'), [error, setError] = useState('')
  const task = useRef(''), starting = useRef(false), early = useRef<JobImportEvent[]>([])
  const alive = useRef(true), generation = useRef(0), ready = useRef(onReady)
  ready.current = onReady
  const eventRef = useRef<(event: JobImportEvent) => void>(() => {})
  eventRef.current = event => {
    if (!alive.current) return
    if (!task.current) { if (starting.current) early.current.push(event); return }
    if (event.taskId !== task.current) return
    if (event.type === 'phase') setPhase(event.phase)
    else {
      task.current = ''; setPhase('idle')
      if (event.type === 'ready') ready.current(event.draft)
      else if (event.type === 'failed') setError(event.error)
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
      task.current = ''; starting.current = false; early.current = []
    }
  }, [data, jobImport])
  async function start(url: string) {
    if (starting.current || task.current || !settings?.default) return
    const version = ++generation.current
    starting.current = true; early.current = []; setPhase('reading'); setError('')
    try {
      const result = await jobImport.start({ url, choice: settings.default })
      if (!alive.current || version !== generation.current) {
        if (result.ok) void jobImport.cancel(result.value).catch(() => {})
        return
      }
      starting.current = false
      if (!result.ok) { setPhase('idle'); setError(result.error); early.current = []; return }
      task.current = result.value.taskId
      for (const message of early.current.splice(0)) eventRef.current(message)
    } catch { if (alive.current && version === generation.current) { starting.current = false; setPhase('idle'); setError('JOB_FETCH_FAILED') } }
  }
  function cancel() {
    generation.current++; starting.current = false; early.current = []
    const id = task.current; task.current = ''; setPhase('idle')
    if (id) void jobImport.cancel({ taskId: id }).catch(() => {})
  }
  const choice = settings?.default, provider = settings?.providers.find(provider => provider.id === choice?.providerId)
  return { start, cancel, clearError: () => setError(''), phase, error, configured: Boolean(choice), provider: provider?.name ?? '', model: choice?.modelId ?? '' }
}
