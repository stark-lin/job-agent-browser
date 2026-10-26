import { useCallback, useEffect, useRef, useState } from 'react'
import type { KnowledgeFile, KnowledgeNode } from '../../domain/knowledge'
import { useUnsavedGuard } from '../../app/navigation/useUnsavedGuard'
export function useKnowledge() {
  const api = window.knowledge,
    [tree, setTree] = useState<KnowledgeNode | null>(null),
    [file, setFile] = useState<KnowledgeFile | null>(null),
    [content, setContent] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [conflict, setConflict] = useState(false)
  const current = useRef<KnowledgeFile | null>(null),
    buffer = useRef(''),
    pending = useRef<Promise<boolean> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    alive = useRef(true)
  const opening = useRef(0)
  const dirty = Boolean(file && content !== file.content)
  useUnsavedGuard(dirty || saving)
  const refresh = useCallback(async () => {
    const result = await api.tree({})
    if (!alive.current) return
    if (result.ok) setTree(result.value)
    else setError(result.error)
  }, [api])
  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current)
    if (pending.current) {
      if (!(await pending.current)) return false
      return flush()
    }
    const f = current.current,
      value = buffer.current
    if (!f || value === f.content) return true
    setSaving(true)
    const job = (async () => {
      try {
        const result = await api.write({ path: f.path, content: value, expectedRevision: f.revision })
        if (!result.ok) {
          if (alive.current) {
            setError(result.error)
            if (result.error === 'KNOWLEDGE_CONFLICT') setConflict(true)
          }
          return false
        }
        current.current = result.value
        if (alive.current) {
          setFile(result.value)
          setError('')
          setConflict(false)
        }
        return true
      } catch {
        if (alive.current) setError('KNOWLEDGE_UNAVAILABLE')
        return false
      } finally {
        if (alive.current) setSaving(false)
      }
    })()
    pending.current = job
    const okay = await job
    pending.current = null
    if (okay && buffer.current !== current.current?.content) return flush()
    return okay
  }, [api])
  const change = (value: string) => {
    buffer.current = value
    setContent(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void flush()
    }, 400)
  }
  const open = useCallback(
    async (path: string) => {
      const generation = ++opening.current
      if (!(await flush())) return false
      const result = await api.read({ path })
      if (!alive.current || generation !== opening.current) return false
      if (!result.ok) {
        setError(result.error)
        return false
      }
      current.current = result.value
      buffer.current = result.value.content
      setFile(result.value)
      setContent(result.value.content)
      setConflict(false)
      setError('')
      return true
    },
    [api, flush]
  )
  const reload = async () => {
    const f = current.current
    if (!f) return
    const r = await api.read({ path: f.path })
    if (r.ok) {
      current.current = r.value
      buffer.current = r.value.content
      setFile(r.value)
      setContent(r.value.content)
      setConflict(false)
      setError('')
    } else setError(r.error)
  }
  const saveAs = async (path: string) => {
    const result = await api.write({ path, content: buffer.current, expectedRevision: null })
    if (!result.ok) {
      setError(result.error)
      return false
    }
    current.current = result.value
    buffer.current = result.value.content
    setFile(result.value)
    setContent(result.value.content)
    setConflict(false)
    setError('')
    await refresh()
    return true
  }
  useEffect(() => {
    alive.current = true
    void refresh()
    const stopFlush = api.onFlush(flush)
    const unsubscribe = api.onChanged(() => {
      void refresh()
      const f = current.current
      if (!f) return
      void api
        .read({ path: f.path })
        .then((r) => {
          if (!alive.current || current.current?.path !== f.path) return
          if (!r.ok) {
            setConflict(true)
            setError(r.error)
            return
          }
          if (r.value.revision === current.current?.revision) return
          if (pending.current) return // Our save event may arrive before invoke resolves.
          if (buffer.current !== f.content) {
            clearTimeout(timer.current)
            setConflict(true)
            setError('KNOWLEDGE_CONFLICT')
            return
          }
          current.current = r.value
          buffer.current = r.value.content
          setFile(r.value)
          setContent(r.value.content)
        })
        .catch(() => {})
    })
    const save = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void flush()
      }
    }
    document.addEventListener('keydown', save)
    return () => {
      alive.current = false
      clearTimeout(timer.current)
      unsubscribe()
      stopFlush()
      document.removeEventListener('keydown', save)
      void flush()
    }
  }, [api, refresh, flush])
  return { tree, file, content, change, open, flush, refresh, error, setError, saving, dirty, conflict, reload, saveAs }
}
