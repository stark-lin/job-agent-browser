import { smartPasteSettings, type SmartPasteSettings } from '../../shared/smart-paste'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useServices } from '../../app/providers'
import { useNavigation } from '../../app/navigation/navigate'
import type { Preferences, PreferencePatch, Mailbox } from '../../shared/settings'

export type Notice = 'saved' | 'saveFailed' | 'invalidSmartPaste' | ''

export function useSettings() {
  const { data, navigation } = useServices()
  const { active } = useNavigation()
  const [knowledgeDirty,setKnowledgeDirty] = useState(false)
  const [saved, setSaved] = useState<Preferences | null>(null)
  const [draft, setDraft] = useState<Preferences | null>(null)
  const [aiDirty, setAIDirty] = useState(false)
  const [loading, setLoading] = useState(true), [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState<'general' | 'mailbox' | 'smartPaste' | null>(null)
  const [notices, setNotices] = useState<Record<'general' | 'mailbox' | 'smartPaste', Notice>>({ general: '', mailbox: '', smartPaste: '' })
  const [attempt, setAttempt] = useState(0)
  const savingLock = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadFailed(false)
    void data.settings.get({}).then(preferences => {
      if (cancelled) return
      if (!preferences.ok) { setLoadFailed(true); return }
      setSaved(preferences.value); setDraft(preferences.value)
    }).catch(() => { if (!cancelled) setLoadFailed(true) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [data, attempt])

  const generalDirty = Boolean(draft && saved && (draft.language !== saved.language || draft.theme !== saved.theme))
  const mailDirty = Boolean(draft && saved && JSON.stringify(draft.mailbox) !== JSON.stringify(saved.mailbox))
  const smartPasteDirty = Boolean(draft && saved && JSON.stringify(draft.smartPaste) !== JSON.stringify(saved.smartPaste))
  const dirty = smartPasteDirty || knowledgeDirty || generalDirty || mailDirty || aiDirty
  const tabId = active?.id, targetId = active?.targetId
  useEffect(() => {
    if (!tabId || !targetId) return
    void navigation.api.setUnsaved(dirty, { tabId, targetId }).catch(() => { /* A closing renderer may outlive its native window. */ })
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = 'unsaved' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      void navigation.api.setUnsaved(false, { tabId, targetId }).catch(() => { /* Ignore cleanup after window disposal. */ })
    }
  }, [dirty, navigation, tabId, targetId])

  const notice = (group: 'general' | 'mailbox' | 'smartPaste', value: Notice) => setNotices(previous => ({ ...previous, [group]: value }))
  const changeLanguage = (language: Preferences['language']) => { setDraft(previous => previous && ({ ...previous, language })); notice('general', '') }
  const changeTheme = (theme: Preferences['theme']) => { setDraft(previous => previous && ({ ...previous, theme })); notice('general', '') }
  const changeMailbox = (mailbox: Mailbox) => { setDraft(previous => previous && ({ ...previous, mailbox })); notice('mailbox', '') }
  const changeSmartPaste = (smartPaste: SmartPasteSettings) => {
    setDraft(previous => previous && ({ ...previous, smartPaste })); notice('smartPaste', '')
  }
  function updateAI(value: Preferences) {
    setSaved(previous => previous && ({ ...previous, ai: value.ai }))
    setDraft(previous => previous && ({ ...previous, ai: value.ai }))
  }

  async function save(group: 'general' | 'mailbox' | 'smartPaste') {
    if (!draft || savingLock.current) return
    savingLock.current = true
    setSaving(group); notice(group, '')
    const patch: PreferencePatch = group === 'smartPaste' ? { smartPaste: smartPasteSettings(draft) } : group === 'general' ? { language: draft.language, theme: draft.theme } : { mailbox: draft.mailbox }
    try {
      const result = await data.settings.savePreferences(patch)
      if (!result.ok) {
        const invalid = group === 'smartPaste' ? 'invalidSmartPaste' : 'saveFailed'
        notice(group, result.error === 'INVALID_INPUT' ? invalid : 'saveFailed')
        return
      }
      setSaved(result.value)
      setDraft(previous => previous && ({ ...previous, ...patch, ...(group === 'mailbox' ? { mailbox: result.value.mailbox } : group === 'smartPaste' ? { smartPaste: result.value.smartPaste } : {}) }))
      notice(group, 'saved')
    } catch { notice(group, 'saveFailed') } finally { savingLock.current = false; setSaving(null) }
  }

  const retry = useCallback(() => setAttempt(value => value + 1), [])
  return { setKnowledgeDirty, setAIDirty, updateAI, draft, loading, loadFailed, retry, saving, notices, dirty, generalDirty, mailDirty,
    smartPasteDirty, changeSmartPaste, changeLanguage, changeTheme, changeMailbox, save }
}
