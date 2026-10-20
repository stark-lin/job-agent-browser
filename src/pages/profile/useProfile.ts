import { useCallback, useEffect, useRef, useState } from 'react'
import { useServices } from '../../app/providers'
import type { Fact, Profile, ProfileItem } from '../../domain/candidate/candidate.types'
import type { PageResult } from '../../domain/common/ports'
import type { Result } from '../../shared/ipc'

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
export function useProfile() {
  const { data, context } = useServices()
  const [profile, setProfile] = useState<Profile | null>(null), [items, setItems] = useState<ProfileItem[]>([]), [facts, setFacts] = useState<Fact[]>([])
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [saving, setSaving] = useState(false), [notice, setNotice] = useState(false)
  const lock = useRef(false), mounted = useRef(true)
  const refresh = useCallback(async (id?: string) => {
    let profile: Profile | null = null
    const current = id ?? context.getSnapshot().profileId
    if (current) {
      const result = await data.profiles.getProfile({ id: current })
      if (result.ok) profile = result.value
      else if (result.error !== 'NOT_FOUND') throw new Error(result.error)
    }
    if (!profile) {
      const result = await data.profiles.listProfiles({ limit: 1 })
      if (!result.ok) throw new Error(result.error)
      profile = result.value.items[0] ?? null
    }
    const [items, facts] = profile ? await Promise.all([
      all(offset => data.profiles.listItems({ profileId: profile!.id, limit: 100, offset })),
      all(offset => data.profiles.listFacts({ profileId: profile!.id, limit: 100, offset }))
    ]) : [[], []]
    if (!mounted.current) return
    setProfile(profile); setItems(items); setFacts(facts); context.setReferences({ profileId: profile?.id ?? null })
  }, [context, data])
  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try { await refresh() } catch { if (mounted.current) setError('loadFailed') }
    finally { if (mounted.current) setLoading(false) }
  }, [refresh])
  useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false } }, [reload])
  async function perform<T>(operation: () => Promise<Result<T>>, profileId?: (value: T) => string): Promise<T | null> {
    if (lock.current) return null
    lock.current = true; setSaving(true); setError(''); setNotice(false)
    try {
      const result = await operation()
      if (!result.ok) { if (mounted.current) setError(result.error); return null }
      const savedProfileId = profileId?.(result.value)
      if (savedProfileId) context.setReferences({ profileId: savedProfileId })
      try { await refresh(savedProfileId); if (mounted.current) setNotice(true) }
      catch { if (mounted.current) setError('loadFailed') }
      // A failed refresh must not make a committed create look safe to submit again.
      return result.value
    } catch { if (mounted.current) setError('STORAGE_UNAVAILABLE'); return null }
    finally { lock.current = false; if (mounted.current) setSaving(false) }
  }
  return { profile, items, facts, loading, error, saving, notice, reload, refresh, perform }
}
