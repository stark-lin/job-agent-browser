import { useCallback, useEffect, useRef, useState } from 'react'
import { useServices } from '../../app/providers'
import { useNavigation } from '../../app/navigation/navigate'
import type { Preferences, PreferencePatch, Mailbox } from '../../shared/settings'

export type Notice = 'saved' | 'keySaved' | 'keyDeleted' | 'saveFailed' | 'encryptionUnavailable' | ''

export function useSettings() {
  const { data, navigation } = useServices()
  const { active } = useNavigation()
  const [saved, setSaved] = useState<Preferences | null>(null)
  const [draft, setDraft] = useState<Preferences | null>(null)
  const [key, setKey] = useState('')
  const [keyStatus, setKeyStatus] = useState({ configured: false, available: false })
  const [loading, setLoading] = useState(true), [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState<'general' | 'mailbox' | 'key' | null>(null)
  const [notices, setNotices] = useState<Record<'general' | 'mailbox' | 'key', Notice>>({ general: '', mailbox: '', key: '' })
  const [attempt, setAttempt] = useState(0)
  const savingLock = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadFailed(false)
    void Promise.all([data.settings.get({}), data.secrets.hasProviderKey({ provider: 'openai' })]).then(([preferences, secret]) => {
      if (cancelled) return
      if (!preferences.ok || !secret.ok) { setLoadFailed(true); return }
      setSaved(preferences.value); setDraft(preferences.value); setKeyStatus(secret.value)
    }).catch(() => { if (!cancelled) setLoadFailed(true) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [data, attempt])

  const generalDirty = Boolean(draft && saved && (draft.language !== saved.language || draft.theme !== saved.theme))
  const mailDirty = Boolean(draft && saved && JSON.stringify(draft.mailbox) !== JSON.stringify(saved.mailbox))
  const dirty = generalDirty || mailDirty || key.length > 0
  const tabId = active?.id, targetId = active?.targetId
  useEffect(() => {
    if (!tabId || !targetId) return
    void navigation.api.setUnsaved(dirty, { tabId, targetId }).catch(() => { /* A closing renderer may outlive its native window. */ })
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      void navigation.api.setUnsaved(false, { tabId, targetId }).catch(() => { /* Ignore cleanup after window disposal. */ })
    }
  }, [dirty, navigation, tabId, targetId])

  const notice = (group: 'general' | 'mailbox' | 'key', value: Notice) => setNotices(previous => ({ ...previous, [group]: value }))
  const changeLanguage = (language: Preferences['language']) => { setDraft(previous => previous && ({ ...previous, language })); notice('general', '') }
  const changeTheme = (theme: Preferences['theme']) => { setDraft(previous => previous && ({ ...previous, theme })); notice('general', '') }
  const changeMailbox = (mailbox: Mailbox) => { setDraft(previous => previous && ({ ...previous, mailbox })); notice('mailbox', '') }
  const changeKey = (value: string) => { setKey(value); notice('key', '') }

  async function save(group: 'general' | 'mailbox') {
    if (!draft || savingLock.current) return
    savingLock.current = true
    setSaving(group); notice(group, '')
    const patch: PreferencePatch = group === 'general' ? { language: draft.language, theme: draft.theme } : { mailbox: draft.mailbox }
    try {
      const result = await data.settings.savePreferences(patch)
      if (!result.ok) { notice(group, 'saveFailed'); return }
      setSaved(result.value)
      setDraft(previous => previous && ({ ...previous, ...patch, ...(group === 'mailbox' ? { mailbox: result.value.mailbox } : {}) }))
      notice(group, 'saved')
    } catch { notice(group, 'saveFailed') } finally { savingLock.current = false; setSaving(null) }
  }

  async function saveKey(remove = false) {
    if (savingLock.current) return
    savingLock.current = true
    setSaving('key'); notice('key', '')
    try {
      const result = remove ? await data.secrets.deleteProviderKey({ provider: 'openai' }) : await data.secrets.saveProviderKey({ provider: 'openai', apiKey: key })
      if (!result.ok) { notice('key', result.error === 'ENCRYPTION_UNAVAILABLE' ? 'encryptionUnavailable' : 'saveFailed'); return }
      setKeyStatus(result.value); setKey(''); notice('key', remove ? 'keyDeleted' : 'keySaved')
    } catch { notice('key', 'saveFailed') } finally { savingLock.current = false; setSaving(null) }
  }

  const retry = useCallback(() => setAttempt(value => value + 1), [])
  return { draft, loading, loadFailed, retry, saving, notices, dirty, generalDirty, mailDirty,
    key, keyStatus, changeLanguage, changeTheme, changeMailbox, changeKey, save, saveKey }
}
