import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../providers'
import type { AIChoice, AIProvider } from '../../shared/ai'
import type { Preferences } from '../../shared/settings'

const endpoints = { openai: 'https://api.openai.com/v1', local: 'http://127.0.0.1:1234/v1', custom: '' }
type ProviderKind = keyof typeof endpoints

function providerKind(endpoint?: string): ProviderKind {
  if (!endpoint) return 'openai'
  const { hostname } = new URL(endpoint)
  if (hostname === 'api.openai.com') return 'openai'
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? 'local' : 'custom'
}

export function useAIConnection(initial?: AIProvider, defaultChoice?: AIChoice | null, onSaved?: (value: Preferences) => void) {
  const { data, ai } = useServices(), { t } = useTranslation()
  const [kind, setKind] = useState(() => providerKind(initial?.baseURL))
  const [id] = useState(() => initial?.id ?? `provider-${crypto.randomUUID()}`)
  const [endpoint, setEndpoint] = useState(initial?.baseURL ?? endpoints.openai), [key, setKey] = useState('')
  const [discovered, setDiscovered] = useState<string[]>([]), [selected, setSelected] = useState<string[]>([])
  const [model, setModel] = useState(''), [choice, setChoice] = useState(defaultChoice ?? null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false)
  const [keyStatus, setKeyStatus] = useState<{ configured: boolean; available: boolean } | null>(null)
  const lock = useRef(false)

  useEffect(() => {
    let active = true
    if (initial?.id) void data.secrets.hasProviderKey({ provider: id }).then(result => {
      if (active && result.ok) setKeyStatus(result.value)
    }).catch(() => {})
    return () => { active = false }
  }, [data, id, initial?.id])

  const hasModels = discovered.length > 0
  const dirty = !saved && (endpoint !== (initial?.baseURL ?? endpoints.openai) || Boolean(key) || hasModels)
  const canReuseKey = (() => {
    try { return Boolean(initial && new URL(initial.baseURL).origin === new URL(endpoint).origin) } catch { return false }
  })()

  function reset() { setDiscovered([]); setSelected([]); setModel(''); setError(''); setSaved(false) }
  async function run(operation: () => Promise<void>) {
    if (lock.current) return false
    lock.current = true; setBusy(true); setError('')
    try { await operation(); return true }
    catch (reason) { setError(reason instanceof Error ? reason.message : t($ => $.settings.saveFailed)); return false }
    finally { lock.current = false; setBusy(false) }
  }

  async function advance(): Promise<'saved' | 'discovered' | null> {
    if (saved) return 'saved'
    if (!hasModels) {
      const ok = await run(async () => {
        const result = await ai.listModels({ baseURL: endpoint, ...(key.trim() ? { apiKey: key } : canReuseKey ? { providerId: id } : {}) })
        if (!result.ok) throw new Error(t($ => $.ai.errors[result.error]))
        const models = result.value
        const existing = initial?.models.filter(item => models.includes(item)) ?? []
        const selected = models.length === 1 ? models : existing
        setDiscovered(models); setSelected(selected)
        setModel(defaultChoice?.providerId === id && selected.includes(defaultChoice.modelId) ? defaultChoice.modelId : selected[0] ?? '')
      })
      return ok ? 'discovered' : null
    }
    if (!model) return null
    const ok = await run(async () => {
      const name = (initial?.models.length ? initial.name : undefined) ?? (kind === 'openai' ? 'OpenAI' : new URL(endpoint).host)
      const overrides = initial?.overrides && Object.fromEntries(Object.entries(initial.overrides).filter(([id]) => selected.includes(id)))
      const result = await data.settings.saveAIConnection({ provider: { id, name, baseURL: endpoint, models: selected, ...(overrides ? { overrides } : {}) }, modelId: model, ...(key.trim() ? { apiKey: key } : {}) })
      if (!result.ok) {
        const reason = result.error === 'ENCRYPTION_UNAVAILABLE' ? 'encryptionUnavailable' : result.error === 'INVALID_INPUT' ? 'invalidAI' : 'saveFailed'
        throw new Error(t($ => $.settings[reason]))
      }
      if (key.trim()) setKeyStatus({ available: true, configured: true })
      setChoice(result.value.ai.default); setKey(''); setSaved(true); onSaved?.(result.value)
    })
    return ok ? 'saved' : null
  }

  return {
    kind, endpoint, key, discovered, selected, model, choice, busy, error, dirty, hasModels, saved,
    ready: saved || (hasModels ? Boolean(model) : Boolean(endpoint.trim()) && (!keyStatus?.configured || canReuseKey || Boolean(key.trim()))),
    keyStatus, canReuseKey,
    changeProvider(value: ProviderKind) { setKind(value); setEndpoint(endpoints[value]); setKey(''); reset() },
    editEndpoint(value: string) { setEndpoint(value); reset() },
    editKey(value: string) { setKey(value); reset() },
    chooseDefault(value: string) {
      if (!selected.includes(value) && selected.length >= 100) return
      if (!selected.includes(value)) setSelected([...selected, value])
      setModel(value); setSaved(false)
    },
    toggle(value: string, enabled: boolean) {
      if (enabled && selected.length >= 100) return
      const next = enabled ? [...selected, value] : selected.filter(item => item !== value)
      setSelected(next); setSaved(false)
      if (!next.includes(model)) setModel(next[0] ?? '')
    },
    advance,
    deleteKey: () => run(async () => {
      const result = await data.secrets.deleteProviderKey({ provider: id })
      if (!result.ok) throw new Error(t($ => $.settings.saveFailed))
      setKeyStatus(result.value); setKey(''); reset()
    })
  }
}
