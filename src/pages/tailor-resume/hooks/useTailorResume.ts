import { useCallback, useEffect, useRef, useState } from 'react'
import { useServices } from '../../../app/providers'
import type { Job } from '../../../domain/job/job.types'
import type { Profile } from '../../../domain/candidate/candidate.types'
import type { RunView } from '../../../domain/resume/resume.types'
import type { ResumeTask } from '../../../platform/electron/resume-contract'
import type { PageResult } from '../../../domain/common/ports'
import type { Result } from '../../../shared/ipc'

async function all<T>(get: (offset: number) => Promise<Result<PageResult<T>>>): Promise<T[]> {
  const rows: T[] = []
  for (;;) {
    const result = await get(rows.length)
    if (!result.ok) throw new Error(result.error)
    rows.push(...result.value.items)
    if (rows.length >= result.value.total) return rows
    if (!result.value.items.length) throw new Error('STORAGE_UNAVAILABLE')
  }
}
export function useTailorResume() {
  const { data, resume, context } = useServices()
  const [jobs, setJobs] = useState<Job[]>([]), [profiles, setProfiles] = useState<Profile[]>([]), [history, setHistory] = useState<RunView[]>([])
  const [jobId, setJobId] = useState(context.getSnapshot().jobId ?? ''), [profileId, setProfileId] = useState(context.getSnapshot().profileId ?? '')
  const [task, setTask] = useState<ResumeTask | null>(null), [preview, setPreview] = useState<{ html: string; pages: number } | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false)
  const alive = useRef(true), lock = useRef(false), selectedRun = useRef<string | undefined>(undefined), revision = useRef(0), sequence = useRef(-1)
  const refresh = useCallback(async () => {
    const version = ++revision.current
    try {
      const result = await resume.getTask(selectedRun.current ? { runId: selectedRun.current } : {})
      if (!alive.current || revision.current !== version) return
      if (!result.ok) { setError(result.error); return }
      setTask(result.value)
      if (result.value?.artifact && context.getSnapshot().artifactId !== result.value.artifact.id) context.setReferences({ artifactId: result.value.artifact.id })
      if (result.value) { selectedRun.current = result.value.run.id; sequence.current = result.value.sequence }
    } catch { if (alive.current && revision.current === version) setError('STORAGE_UNAVAILABLE') }
  }, [resume, context])
  const refreshHistory = useCallback(async () => {
    try {
      const result = await data.resumes.listRuns({ limit: 100 })
      if (alive.current && result.ok) setHistory(result.value.items)
    } catch { if (alive.current) setError('STORAGE_UNAVAILABLE') }
  }, [data])
  useEffect(() => {
    alive.current = true
    void Promise.all([all(offset => data.jobs.listJobs({ limit: 100, offset })), all(offset => data.profiles.listProfiles({ limit: 100, offset }))])
      .then(([jobs, profiles]) => {
        if (!alive.current) return
        setJobs(jobs); setProfiles(profiles)
        setJobId(id => jobs.some(job => job.id === id) ? id : jobs[0]?.id ?? '')
        setProfileId(id => profiles.some(profile => profile.id === id) ? id : profiles[0]?.id ?? '')
      }).catch(() => { if (alive.current) setError('STORAGE_UNAVAILABLE') })
    void refresh(); void refreshHistory()
    const unsubscribe = resume.onEvent(event => {
      if (selectedRun.current && event.runId !== selectedRun.current || event.sequence <= sequence.current) return
      sequence.current = event.sequence
      void refresh()
      if (event.stage === 'completed') void refreshHistory()
    })
    return () => { alive.current = false; unsubscribe() }
  }, [data, resume, refresh, refreshHistory])
  const artifactId = task?.artifact?.id, output = task?.artifact?.output.status
  useEffect(() => {
    setPreview(null)
    if (!artifactId || output !== 'READY') return
    let current = true
    void resume.getPreview({ artifactId }).then(result => {
      if (current && alive.current) { if (result.ok) setPreview(result.value); else { setError(result.error); void refresh() } }
    }).catch(() => { if (current && alive.current) setError('OUTPUT_FAILED') })
    return () => { current = false }
  }, [resume, artifactId, output, refresh])
  async function action(operation: () => Promise<Result<unknown>>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setSaved(false)
    try {
      const result = await operation()
      if (!result.ok) { if (alive.current) setError(result.error); await refresh(); return }
      await refresh(); await refreshHistory()
    } catch { if (alive.current) setError('STORAGE_UNAVAILABLE') }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  return { jobs, profiles, history, jobId, profileId, setJobId, setProfileId, task, preview, error, busy, saved, refresh,
    start: () => action(async () => {
      const result = await resume.start({ jobId, profileId })
      if (result.ok) { selectedRun.current = result.value.runId; sequence.current = -1; context.setReferences({ jobId, profileId }) }
      return result
    }),
    cancel: () => action(() => resume.cancel({ runId: task!.run.id })),
    retry: () => action(() => resume.retryOutput({ artifactId: task!.artifact!.id })),
    exportPdf: () => action(async () => { const result = await resume.exportPdf({ artifactId: task!.artifact!.id }); if (result.ok && alive.current) setSaved(result.value.saved); return result }),
    selectRun: (id: string) => { selectedRun.current = id; sequence.current = -1; setError(''); void refresh() }
  }
}
