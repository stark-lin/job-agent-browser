import { useEffect, useRef, useState } from 'react'
import { useServices } from '../../app/providers'
import { allowsParallelImport, type AIChoice, type AISettings } from '../../shared/ai'
import type { ApplyImport, ImportDraft } from '../../domain/candidate/import.types'
import type { Profile } from '../../domain/candidate/candidate.types'
import type { ImportEvent, ImportTask, PdfSelection } from '../../platform/electron/profile-import-contract'
import type { ImportMode, ImportGroupProgress } from '../../shared/import'
import { importError, importSelection, savedSelection } from './import-state'

export function useProfileImport(profile: Profile | null, onSaved: (profile: Profile) => Promise<void>) {
  const { data, profileImport, context } = useServices()
  const [settings, setSettings] = useState<AISettings | null>(null), [draft, setDraft] = useState<ImportDraft | null>(null)
  const [stage, setStage] = useState<'idle' | 'selecting' | 'extracting' | 'parsing' | 'ready' | 'failed'>('idle')
  const [progress, setProgress] = useState({ page: 0, pages: 0 }), [error, setError] = useState(''), [saved, setSaved] = useState(false), [saving, setSaving] = useState(false)
  const [frozen, setFrozen] = useState(false), [mode, setMode] = useState<ImportMode>('single')
  const [groups, setGroups] = useState<ImportGroupProgress[]>([]), [retryable, setRetryable] = useState(false)
  const selectedMode = useRef<ImportMode>('single')
  const file = useRef<PdfSelection | null>(null), task = useRef<ImportTask | null>(null), alive = useRef(true), lock = useRef(false)
  const pending = useRef<ApplyImport | null>(null), early = useRef<ImportEvent[]>([]), starting = useRef(false)
  const selected = useRef<AIChoice | null>(null), [choice, setChoice] = useState<AIChoice | null>(null)
  const importedProfileId = useRef<string | null>(null)
  function event(message: ImportEvent) {
    if (!alive.current) return
    if (!task.current) { if (starting.current) early.current.push(message); return }
    if (message.sessionId !== task.current.sessionId || message.taskId !== task.current.taskId) return
    if (message.type === 'phase') { setStage(message.phase); setProgress({ page: message.page ?? 0, pages: message.pages ?? 0 }) }
    else if (message.type === 'progress') setGroups(message.groups)
    else if (message.type === 'ready') { setDraft(message.draft); setStage('ready') }
    else {
      if (message.type === 'cancelled') setGroups(groups => groups.map(group => ['queued', 'running'].includes(group.state) ? { ...group, state: 'cancelled' } : group))
      setError(message.type === 'failed' ? message.error : 'AI_CANCELLED'); setStage('failed'); setRetryable(message.type === 'failed' && Boolean(message.retryable))
    }
  }
  useEffect(() => {
    alive.current = true
    void data.settings.get({}).then(result => { if (alive.current && result.ok) { setSettings(result.value.ai); setChoice(result.value.ai.default) } }).catch(() => { if (alive.current) setError('STORAGE_UNAVAILABLE') })
    const unsubscribe = profileImport.onEvent(event)
    return () => {
      alive.current = false; unsubscribe()
      if (file.current) void profileImport.discard({ fileId: file.current.fileId }).catch(() => {})
    }
  }, [data, profileImport])
  async function start(retry = false) {
    if (!file.current || !selected.current || starting.current) return
    const previous = task.current
    task.current = null; starting.current = true; early.current = []; setError(''); setSaved(false); setStage(retry ? 'parsing' : 'extracting'); setRetryable(false)
    if (!retry) setGroups([])
    try {
      const result = retry && previous ? await profileImport.retry({ sessionId: previous.sessionId })
        : await profileImport.start({ fileId: file.current.fileId, choice: selected.current, mode: selectedMode.current })
      if (!alive.current) return
      if (!result.ok) { setError(result.error); setStage('failed'); return }
      task.current = result.value
      for (const message of early.current) event(message)
    } catch { if (alive.current) { setError('AI_CONNECT_FAILED'); setStage('failed') } }
    finally { starting.current = false; early.current = [] }
  }
  async function upload() {
    if (lock.current || !choice) return
    lock.current = true; selected.current = choice; selectedMode.current = allowsParallelImport(settings, choice) ? mode : 'single'; setGroups([]); setRetryable(false); setError(''); setStage('selecting')
    try {
      const result = await profileImport.selectPdf()
      if (!alive.current) { if (result.ok && result.value) void profileImport.discard({ fileId: result.value.fileId }); return }
      if (!result.ok) { setError(result.error); setStage('failed'); return }
      if (!result.value) { setStage('idle'); return }
      file.current = result.value; await start()
    } catch { if (alive.current) { setError('PDF_INVALID'); setStage('failed') } }
    finally { lock.current = false }
  }
  async function discard() {
    if (saving) return
    try {
      if (file.current) await profileImport.discard({ fileId: file.current.fileId })
      file.current = null; task.current = null; pending.current = null
      setDraft(null); setError(''); setGroups([]); setRetryable(false); setStage('idle'); setSaved(false); setFrozen(false)
    } catch { setError('STORAGE_UNAVAILABLE') }
  }
  async function save() {
    if (!draft || !task.current || lock.current) return
    const invalid = importError(draft)
    if (!pending.current && invalid) {
      setError('INVALID_INPUT')
      const editor = document.querySelector(`[data-import-id="${invalid}"]`)
      editor?.scrollIntoView({ block: 'center' }); editor?.querySelector<HTMLElement>('input, textarea, select')?.focus()
      return
    }
    const input = pending.current ?? importSelection(draft, task.current.sessionId, crypto.randomUUID(), profile?.id ?? importedProfileId.current)
    if (!Object.keys(input.contact).length && !input.items.length && !input.facts.length && !input.links.length) { setError('noContent'); return }
    if (!input.profileId && !input.contact.name?.trim()) { setError('nameRequired'); return }
    lock.current = true; setSaving(true); setError(''); pending.current = input; setFrozen(true)
    try {
      const result = await data.profiles.applyImport(input)
      if (!alive.current) return
      if (!result.ok) { setError(result.error); pending.current = null; setFrozen(false); return }
      importedProfileId.current = result.value.profile.id
      context.setReferences({ profileId: result.value.profile.id })
      setDraft(savedSelection(draft, input, result.value)); pending.current = null; setFrozen(false); setSaved(true)
      await onSaved(result.value.profile)
    } catch { if (alive.current) setError('STORAGE_UNAVAILABLE') }
    finally { lock.current = false; if (alive.current) setSaving(false) }
  }
  return { settings, choice, mode, setMode, groups, retryable, parallelAllowed: allowsParallelImport(settings, choice), draft, setDraft, stage, error, progress, saved, saving, frozen, upload, start, discard, save,
    hasFile: Boolean(file.current), stop: () => { if (task.current) void profileImport.cancel({ sessionId: task.current.sessionId }).catch(() => setError('AI_CONNECT_FAILED')) } }
}
