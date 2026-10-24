import { useEffect, useState } from 'react'
import { useServices } from '../../app/providers'
import type { ApplicationStatus, Job } from '../../domain/job/job.types'
import type { PageResult } from '../../domain/common/ports'

export const jobsPageSize = 25
export function useApplications() {
  const { data } = useServices()
  const [query, setQuery] = useState({ search: '', status: '' as ApplicationStatus | '', offset: 0, archived: false })
  const [result, setResult] = useState<PageResult<Job>>({ items: [], total: 0 })
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    setLoading(true); setError('')
    void data.jobs.listJobs({ limit: jobsPageSize, offset: query.offset, search: query.search, archived: query.archived, ...(query.status ? { status: query.status } : {}) }).then(response => {
      if (disposed) return
      if (!response.ok) { setError(response.error); return }
      if (query.offset && query.offset >= response.value.total) { setQuery({ ...query, offset: 0 }); return }
      setResult(response.value)
    }).catch(() => { if (!disposed) setError('STORAGE_UNAVAILABLE') }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [data, query])
  return { result, loading, error, offset: query.offset,
    apply: (search: string, status: ApplicationStatus | '', archived: boolean) => setQuery({ search: search.trim(), status, offset: 0, archived }),
    refresh: () => setQuery(current => ({ ...current, offset: 0 })),
    previous: () => setQuery(current => ({ ...current, offset: Math.max(0, current.offset - jobsPageSize) })),
    next: () => setQuery(current => ({ ...current, offset: Math.min(1000000, current.offset + jobsPageSize) })),
    hasNext: query.offset + jobsPageSize < result.total && query.offset < 1000000 }
}
