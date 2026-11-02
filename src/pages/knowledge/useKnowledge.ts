import { useCallback, useEffect, useRef, useState } from 'react'
import type { KnowledgeFile, KnowledgeNode } from '../../domain/knowledge'
import type { SpaceId, NoteSelection } from '../../shared/smart-note'
import { noteKey } from '../../shared/smart-note'
import { useUnsavedGuard } from '../../app/navigation/useUnsavedGuard'
type OpenFile = KnowledgeFile & { space: SpaceId }
export function useKnowledge() {
  const api = window.knowledge
  const [trees, setTrees] = useState<Record<SpaceId, KnowledgeNode | null>>({ knowledge: null, memory: null })
  const [selection, setSelection] = useState<NoteSelection>({ space: 'knowledge', path: '' })
  const [file, setFile] = useState<OpenFile | null>(null), [content, setContent] = useState('')
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [conflict, setConflict] = useState(false)
  const current = useRef<OpenFile | null>(null), buffer = useRef(''), pending = useRef<Promise<boolean> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), alive = useRef(true), opening = useRef(0)
  const scope = useRef<SpaceId>('knowledge')
  const dirty = Boolean(file && content !== file.content)
  useUnsavedGuard(dirty || saving)
  const refresh = useCallback(async () => {
    const results = await Promise.all((['knowledge', 'memory'] as const).map(async space => ({ space, result: await api.tree({ space }) })))
    if (!alive.current) return
    for (const { space, result } of results) {
      if (result.ok) setTrees(old => ({ ...old, [space]: result.value }))
      else setError(result.error)
    }
  }, [api])
  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current)
    if (pending.current) { if (!(await pending.current)) return false; return flush() }
    const f = current.current, value = buffer.current
    if (!f || value === f.content) return true
    setSaving(true)
    const job = (async () => {
      try {
        const result = await api.write({ space: f.space, path: f.path, content: value, expectedRevision: f.revision })
        if (!result.ok) {
          if (alive.current) { setError(result.error); if (result.error === 'KNOWLEDGE_CONFLICT') setConflict(true) }
          return false
        }
        if (current.current !== f) return false
        current.current = { ...result.value, space: f.space }
        if (alive.current) { setFile(current.current); setError(''); setConflict(false) }
        return true
      } catch { if (alive.current) setError('KNOWLEDGE_UNAVAILABLE'); return false }
      finally { if (alive.current) setSaving(false) }
    })()
    pending.current = job
    const okay = await job; pending.current = null
    if (okay && buffer.current !== current.current?.content) return flush()
    return okay
  }, [api])
  const change = (value: string) => {
    buffer.current = value; setContent(value); clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 400)
  }
  const choose = useCallback(async (target: NoteSelection, path?: string) => {
    const generation = ++opening.current
    if (!(await flush()) || generation !== opening.current) return false
    const result = path ? await api.read({ space: target.space, path }) : null
    if (!alive.current || generation !== opening.current) return false
    if (result && !result.ok) { setError(result.error); return false }
    scope.current = target.space; setSelection(target)
    current.current = result?.ok ? { ...result.value, space: target.space } : null
    buffer.current = current.current?.content ?? ''
    setFile(current.current); setContent(buffer.current); setConflict(false); setError('')
    return true
  }, [api, flush])
  const open = useCallback((path: string, space: SpaceId = scope.current) => choose({ space, path }, path), [choose])
  const select = (node: KnowledgeNode, space: SpaceId) => choose({ space, path: node.path }, node.type === 'file' ? node.path : node.readme)
  const reload = async () => {
    if (pending.current) await pending.current
    const f = current.current; if (!f) return
    const r = await api.read({ space: f.space, path: f.path })
    if (current.current !== f) return
    if (r.ok) {
      current.current = { ...r.value, space: f.space }; buffer.current = r.value.content
      setFile(current.current); setContent(buffer.current); setConflict(false); setError('')
    } else setError(r.error)
  }
  const saveAs = async (path: string) => {
    clearTimeout(timer.current)
    if (pending.current) await pending.current
    const f = current.current, space = f?.space ?? scope.current, value = buffer.current
    const result = await api.write({ space, path, content: value, expectedRevision: null })
    if (!result.ok) { setError(result.error); return false }
    if (current.current !== f) return false
    current.current = { ...result.value, space }; buffer.current = result.value.content
    setFile(current.current); setContent(buffer.current); setSelection({ space, path }); setConflict(false); setError('')
    await refresh(); return true
  }
  useEffect(() => {
    alive.current = true; void refresh()
    const stopFlush = api.onFlush(flush)
    const unsubscribe = api.onChanged(() => {
      void refresh()
      const f = current.current; if (!f) return
      void api.read({ space: f.space, path: f.path }).then(r => {
        if (!alive.current || !current.current || noteKey(current.current) !== noteKey(f) || current.current !== f || pending.current) return
        if (!r.ok) { setConflict(true); setError(r.error); return }
        if (r.value.revision === f.revision) return
        if (buffer.current !== f.content) { clearTimeout(timer.current); setConflict(true); setError('KNOWLEDGE_CONFLICT'); return }
        current.current = { ...r.value, space: f.space }; buffer.current = r.value.content; setFile(current.current); setContent(buffer.current)
      }).catch(() => {})
    })
    const save = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void flush() } }
    document.addEventListener('keydown', save)
    return () => { alive.current = false; clearTimeout(timer.current); unsubscribe(); stopFlush(); document.removeEventListener('keydown', save); void flush() }
  }, [api, refresh, flush])
  return { scope, trees, tree: trees[selection.space], selection, file, content, change, open, select, flush, refresh, error, setError, saving, dirty, conflict, reload, saveAs }
}
