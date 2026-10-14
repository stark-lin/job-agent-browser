import { useEffect, useState } from 'react'
import { useServices } from '../../app/providers'
import type { AuditEntry, AuditFilter, PageResult } from '../../domain/common/ports'

export const auditPageSize = 25
const maxOffset = 1_000_000

export function useAuditViewer() {
  const { data } = useServices()
  const [query, setQuery] = useState<{ filter: AuditFilter; offset: number }>({ filter: {}, offset: 0 })
  const [result, setResult] = useState<PageResult<AuditEntry>>({ items: [], total: 0 })
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    setLoading(true); setFailed(false); setResult({ items: [], total: 0 })
    void data.audit.list({ ...query.filter, limit: auditPageSize, offset: query.offset }).then(response => {
      if (cancelled) return
      if (!response.ok) { setFailed(true); return }
      // A count can shrink while traversing; restart rather than show an empty last page.
      if (query.offset > 0 && query.offset >= response.value.total) { setQuery({ ...query, offset: 0 }); return }
      setResult(response.value)
    }).catch(() => { if (!cancelled) setFailed(true) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [data, query])
  const apply = (filter: AuditFilter) => setQuery({ filter, offset: 0 })
  const refresh = () => setQuery(previous => ({ ...previous, offset: 0 }))
  const previous = () => setQuery(current => ({ ...current, offset: Math.max(0, current.offset - auditPageSize) }))
  const next = () => setQuery(current => ({ ...current, offset: Math.min(maxOffset, current.offset + auditPageSize) }))
  return { result, loading, failed, apply, refresh, previous, next, offset: query.offset,
    filtered: Object.keys(query.filter).length > 0,
    hasNext: query.offset + auditPageSize < result.total && query.offset < maxOffset }
}
