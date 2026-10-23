import { useCallback, useEffect, useRef, useState } from 'react'
import { useServices } from '../../app/providers'
import { useNavigation } from '../../app/navigation/navigate'
import type { Preferences, PreferencePatch, Mailbox } from '../../shared/settings'
import type { AIProvider, AISettings } from '../../shared/ai'

export type Notice = 'saved' | 'keySaved' | 'keyDeleted' | 'saveFailed' | 'encryptionUnavailable' | 'invalidAI' | ''

export function useSettings() {
  const { data, navigation } = useServices()
  const { active } = useNavigation()
  const [saved, setSaved] = useState<Preferences | null>(null)
  const [draft, setDraft] = useState<Preferences | null>(null)
  const [selectedProvider, setSelectedProvider] = useState('openai')
  const [key, setKey] = useState('')
  const [keyStatus, setKeyStatus] = useState({ configured: false, available: false })
  const [keyReady, setKeyReady] = useState(false)
  const [keyLoadFailed, setKeyLoadFailed] = useState(false), [keyAttempt, setKeyAttempt] = useState(0)
  const [loading, setLoading] = useState(true), [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState<'general' | 'mailbox' | 'ai' | 'key' | null>(null)
  const [notices, setNotices] = useState<Record<'general' | 'mailbox' | 'ai' | 'key', Notice>>({ general: '', mailbox: '', ai: '', key: '' })
  const [attempt, setAttempt] = useState(0)
  const savingLock = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadFailed(false)
    void data.settings.get({}).then(preferences => {
      if (cancelled) return
      if (!preferences.ok) { setLoadFailed(true); return }
      setSaved(preferences.value); setDraft(preferences.value)
      setSelectedProvider(current => preferences.value.ai.providers.some(p => p.id === current) ? current : preferences.value.ai.providers[0]?.id ?? '')
    }).catch(() => { if (!cancelled) setLoadFailed(true) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [data, attempt])

  useEffect(() => {
    let cancelled = false
    setKey(''); setKeyReady(false); setKeyLoadFailed(false); setKeyStatus({ configured: false, available: false })
    if (selectedProvider) void data.secrets.hasProviderKey({ provider: selectedProvider }).then(result => {
      if (!cancelled && result.ok) { setKeyStatus(result.value); setKeyReady(true) }
      else if (!cancelled) setKeyLoadFailed(true)
    }).catch(() => { if (!cancelled) setKeyLoadFailed(true) })
    return () => { cancelled = true }
  }, [data, selectedProvider, attempt, keyAttempt])

  const provider = draft?.ai.providers.find(p => p.id === selectedProvider)
  const providerSaved = Boolean(saved?.ai.providers.some(p => p.id === selectedProvider))
  const aiDirty = Boolean(draft && saved && JSON.stringify(draft.ai) !== JSON.stringify(saved.ai))
  const generalDirty = Boolean(draft && saved && (draft.language !== saved.language || draft.theme !== saved.theme))
  const mailDirty = Boolean(draft && saved && JSON.stringify(draft.mailbox) !== JSON.stringify(saved.mailbox))
  const dirty = generalDirty || mailDirty || aiDirty || key.length > 0
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

  const notice = (group: 'general' | 'mailbox' | 'ai' | 'key', value: Notice) => setNotices(previous => ({ ...previous, [group]: value }))
  const changeLanguage = (language: Preferences['language']) => { setDraft(previous => previous && ({ ...previous, language })); notice('general', '') }
  const changeTheme = (theme: Preferences['theme']) => { setDraft(previous => previous && ({ ...previous, theme })); notice('general', '') }
  const changeMailbox = (mailbox: Mailbox) => { setDraft(previous => previous && ({ ...previous, mailbox })); notice('mailbox', '') }
  const changeKey = (value: string) => { setKey(value); notice('key', '') }

  const changeAI = (ai: AISettings) => { setDraft(previous => previous && ({ ...previous, ai })); notice('ai', '') }
  const editProvider = (patch: Partial<AIProvider>) => {
    if (!draft || !provider) return
    const next = { ...provider, ...patch }
    if (next.parallelModels) next.parallelModels = next.parallelModels.filter(model => next.models.includes(model))
    if (!next.models.includes(next.defaultModel)) next.defaultModel = next.models[0] ?? ''
    let choice = draft.ai.default
    if (choice?.providerId === next.id && !next.models.includes(choice.modelId)) choice = next.defaultModel ? { providerId: next.id, modelId: next.defaultModel } : null
    changeAI({ ...draft.ai, providers: draft.ai.providers.map(p => p.id === next.id ? next : p), default: choice })
  }
  const addProvider = () => {
    if (!draft || draft.ai.providers.length >= 20) return
    const id = `provider-${crypto.randomUUID()}`
    changeAI({ ...draft.ai, providers: [...draft.ai.providers, { id, name: '', baseURL: '', requiresKey: true, models: [], defaultModel: '' }] })
    setSelectedProvider(id)
  }
  const removeProvider = () => {
    if (!draft || !provider || keyStatus.configured || (!keyReady && providerSaved)) return
    const providers = draft.ai.providers.filter(p => p.id !== provider.id)
    changeAI({ ...draft.ai, providers, default: draft.ai.default?.providerId === provider.id ? null : draft.ai.default })
    setSelectedProvider(providers[0]?.id ?? '')
  }

  async function save(group: 'general' | 'mailbox' | 'ai') {
    if (!draft || savingLock.current) return
    savingLock.current = true
    setSaving(group); notice(group, '')
    const patch: PreferencePatch = group === 'general' ? { language: draft.language, theme: draft.theme } : group === 'ai' ? { ai: { ...draft.ai, providers: draft.ai.providers.map(p => ({ ...p, models: p.models.map(model => model.trim()).filter(Boolean), defaultModel: p.defaultModel.trim() })), default: draft.ai.default && { ...draft.ai.default, modelId: draft.ai.default.modelId.trim() } } } : { mailbox: draft.mailbox }
    try {
      const result = await data.settings.savePreferences(patch)
      if (!result.ok) { notice(group, group === 'ai' && result.error === 'INVALID_INPUT' ? 'invalidAI' : 'saveFailed'); return }
      setSaved(result.value)
      setDraft(previous => previous && ({ ...previous, ...patch, ...(group === 'mailbox' ? { mailbox: result.value.mailbox } : group === 'ai' ? { ai: result.value.ai } : {}) }))
      notice(group, 'saved')
    } catch { notice(group, 'saveFailed') } finally { savingLock.current = false; setSaving(null) }
  }

  async function saveKey(remove = false) {
    if (savingLock.current || !providerSaved) return
    savingLock.current = true
    setSaving('key'); notice('key', '')
    try {
      const result = remove ? await data.secrets.deleteProviderKey({ provider: selectedProvider }) : await data.secrets.saveProviderKey({ provider: selectedProvider, apiKey: key })
      if (!result.ok) { notice('key', result.error === 'ENCRYPTION_UNAVAILABLE' ? 'encryptionUnavailable' : 'saveFailed'); return }
      setKeyStatus(result.value); setKey(''); notice('key', remove ? 'keyDeleted' : 'keySaved')
    } catch { notice('key', 'saveFailed') } finally { savingLock.current = false; setSaving(null) }
  }

  const retry = useCallback(() => setAttempt(value => value + 1), [])
  return { provider, providerSaved, keyReady, keyLoadFailed, retryKey: () => setKeyAttempt(value => value + 1), selectedProvider, setSelectedProvider, aiDirty, changeAI, editProvider, addProvider, removeProvider, draft, loading, loadFailed, retry, saving, notices, dirty, generalDirty, mailDirty,
    key, keyStatus, changeLanguage, changeTheme, changeMailbox, changeKey, save, saveKey }
}
