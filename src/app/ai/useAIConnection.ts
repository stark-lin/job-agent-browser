import { useEffect, useRef, useState } from 'react'
import { AI_DEFAULTS, normalizeAIEndpoint, validModelId, type AIError, type AIProvider, type AISettings, type AITimeoutOverrides, type AuthenticationOverride, type ModelOverrides } from '../../shared/ai'
import type { Preferences } from '../../shared/settings'
import { useServices } from '../providers'

export const presetEndpoints = {
  openai: 'https://api.openai.com/v1', local: 'http://127.0.0.1:1234/v1', custom: ''
}
type Preset = 'auto' | keyof typeof presetEndpoints
export const timeoutDefaults = {
  requestSeconds: AI_DEFAULTS.requestTimeoutMs / 1000,
  modelsSeconds: AI_DEFAULTS.modelsTimeoutMs / 1000,
  pageSeconds: AI_DEFAULTS.pageTimeoutMs / 1000,
}
type SubmitError = AIError | 'invalidEndpoint' | 'invalidModel' | 'invalidLimits'
const connectionName = (endpoint: string) => {
  const normalized = normalizeAIEndpoint(endpoint)
  if (!normalized) return ''
  const url = new URL(normalized)
  return url.hostname === 'api.openai.com' ? 'OpenAI' : url.host.slice(0, 100)
}

export function useAIConnection(settings: AISettings, id: string, onSaved: (preferences: Preferences) => void) {
  const { ai, data } = useServices()
  const [saved, setSaved] = useState(() => settings.providers.find(provider => provider.id === id))
  const [savedTimeouts, setSavedTimeouts] = useState(settings.timeoutOverrides)
  const [savedChoice, setSavedChoice] = useState(settings.default)
  const [endpoint, setEndpoint] = useState(saved?.baseURL ?? presetEndpoints.openai)
  const [name, setName] = useState(saved?.name ?? '')
  const [preset, setPreset] = useState<Preset>('auto')
  const [auth, setAuth] = useState<AuthenticationOverride | undefined>(saved?.authMode)
  const [key, setKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [models, setModels] = useState(saved?.models ?? [])
  const [model, setModel] = useState(savedChoice?.providerId === id ? savedChoice.modelId : models.length === 1 ? models[0] : '')
  const [manualId, setManualId] = useState('')
  const [overrides, setOverrides] = useState<NonNullable<AIProvider['overrides']>>(saved?.overrides ?? {})
  const [timeouts, setTimeouts] = useState<AITimeoutOverrides>(savedTimeouts ?? {})
  const [checked, setChecked] = useState(Boolean(saved?.models.length))
  const [needsModel, setNeedsModel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<SubmitError | 'saved' | ''>('')
  const lock = useRef(false)
  const normalized = normalizeAIEndpoint(endpoint)
  const sameEndpoint = saved !== undefined && normalized === saved.baseURL
  const override = Object.hasOwn(overrides, model) ? overrides[model] : undefined
  const timeoutsDirty = JSON.stringify(timeouts) !== JSON.stringify(savedTimeouts ?? {})
  const dirty = (saved ? endpoint !== saved.baseURL || name !== saved.name || auth !== saved.authMode
    || JSON.stringify(models) !== JSON.stringify(saved.models) || JSON.stringify(overrides) !== JSON.stringify(saved.overrides ?? {})
    || model !== (savedChoice?.providerId === id ? savedChoice.modelId : saved.models.length === 1 ? saved.models[0] : '')
    : endpoint !== presetEndpoints.openai || Boolean(name || auth || models.length))
    || timeoutsDirty || Boolean(key || clearKey || manualId)

  useEffect(() => {
    let live = true
    if (saved) void data.secrets.hasProviderKey({ provider: id }).then(result => {
      if (live && result.ok) setKeyConfigured(result.value.configured)
    }).catch(() => {})
    return () => { live = false }
  }, [data, id, saved])

  function invalidate() { setChecked(false); setNotice(''); setNeedsModel(false) }
  function editEndpoint(value: string) {
    if (normalizeAIEndpoint(value) !== normalized || !normalized) {
      setModels([]); setModel(''); setOverrides({}); setKey(''); setClearKey(false)
      if (!name || name === connectionName(endpoint)) setName('')
      invalidate()
    }
    setEndpoint(value)
  }
  function editPreset(value: Preset) {
    setPreset(value)
    if (value !== 'auto') editEndpoint(presetEndpoints[value])
  }
  function editKey(value: string) { setKey(value); setClearKey(false); invalidate() }
  function removeKey(value: boolean) { setClearKey(value); setKey(''); invalidate() }
  function editAuth(value: AuthenticationOverride | undefined) { setAuth(value); invalidate() }
  function selectModel(value: string) { setModel(value); setNeedsModel(false); setNotice('') }
  function addModel() {
    const id = manualId.trim()
    if (!validModelId(id)) { setNotice('invalidModel'); return }
    setModels(current => [...new Set([...current, id])])
    if (!model) selectModel(id)
    setManualId('')
  }
  function removeModel() {
    setModels(current => current.filter(id => id !== model))
    setOverrides(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== model)))
    selectModel('')
  }
  function editOverride(field: keyof ModelOverrides, value: number | undefined) {
    if (!model) return
    const next = { ...override, [field]: value }
    if (value === undefined) delete next[field]
    setOverrides(current => ({ ...current, [model]: next }))
    setNotice('')
  }
  function editTimeout(field: keyof AITimeoutOverrides, value: number | undefined) {
    setTimeouts(current => {
      const next = { ...current, [field]: value }
      if (value === undefined) delete next[field]
      return next
    })
    setNotice('')
  }
  function restoreDefaults() {
    setName(''); setPreset('auto'); setOverrides({}); setTimeouts({}); setNotice('')
    if (auth !== undefined) editAuth(undefined)
  }

  async function submit() {
    if (lock.current) return
    if (!normalized) { setNotice('invalidEndpoint'); return }
    const extra = manualId.trim()
    if (extra && !validModelId(extra)) { setNotice('invalidModel'); return }
    if (Object.values(timeouts).some(value => !Number.isSafeInteger(value) || value < 1 || value > 3600)
      || Object.values(overrides).some(({ contextWindow, maxOutputTokens }) =>
        [contextWindow, maxOutputTokens].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 100_000_000))
        || (contextWindow !== undefined && maxOutputTokens !== undefined && maxOutputTokens > contextWindow))) {
      setNotice('invalidLimits'); return
    }
    lock.current = true
    setBusy(true); setNotice(''); setNeedsModel(false)
    try {
      const credential = key.trim() ? { apiKey: key.trim() } : clearKey ? { clearKey } : {}
      let available = [...new Set([...models, ...(extra ? [extra] : [])])]
      let selected = model
      if (!checked) {
        const result = await ai.listModels({
          baseURL: normalized, ...(sameEndpoint ? { providerId: id } : {}), ...credential,
          ...(auth ? { authMode: auth } : {}), modelsSeconds: timeouts.modelsSeconds ?? timeoutDefaults.modelsSeconds
        })
        if (!result.ok) { setNotice(result.error); return }
        available = [...new Set([...result.value, ...available])]
        if (!selected && result.value.length === 1) selected = result.value[0]
        setChecked(true)
      }
      if (!selected && available.length === 1) selected = available[0]
      setModels(available); setManualId(''); setModel(selected)
      if (!available.includes(selected)) { setNeedsModel(true); return }

      const provider: AIProvider = {
        id, name: name.trim() || connectionName(endpoint), baseURL: normalized, models: available,
        ...(auth ? { authMode: auth } : {}),
        overrides: Object.fromEntries(Object.entries(overrides).filter(([id, limits]) => available.includes(id) && Object.keys(limits).length > 0))
      }
      const result = await ai.saveConnection({
        provider, modelId: selected, ...(saved ? { previousEndpoint: saved.baseURL } : {}), ...credential, ...(timeoutsDirty ? { timeoutOverrides: timeouts } : {})
      })
      if (!result.ok) { setNotice(result.error); return }
      const next = result.value.ai.providers.find(provider => provider.id === id)!
      setSaved(next); setSavedChoice(result.value.ai.default); setSavedTimeouts(result.value.ai.timeoutOverrides)
      setEndpoint(next.baseURL); setName(next.name); setOverrides(next.overrides ?? {}); setTimeouts(result.value.ai.timeoutOverrides ?? {}); setKey(''); setClearKey(false)
      setKeyConfigured(Boolean(credential.apiKey || sameEndpoint && keyConfigured && !clearKey))
      setNotice('saved')
      onSaved(result.value)
    } catch { setNotice('STORAGE_UNAVAILABLE') }
    finally { lock.current = false; setBusy(false) }
  }

  return { endpoint, editEndpoint, name, editName: setName, generatedName: connectionName(endpoint), preset, editPreset, auth, editAuth,
    key, editKey, keyConfigured: keyConfigured && sameEndpoint, replacingEndpoint: keyConfigured && Boolean(normalized) && !sameEndpoint, clearKey, removeKey, model, models, selectModel,
    manualId, editManualId: setManualId, addModel, removeModel, override, editOverride, timeouts, editTimeout,
    dirty, busy, notice, needsModel, restoreDefaults, submit }
}
