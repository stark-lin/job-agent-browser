import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import { useAIRequest } from '../../app/ai/useAIRequest'
import type { Preferences } from '../../shared/settings'

export function useOnboardingModel(preferences: Preferences) {
  const { data, ai } = useServices(), { t } = useTranslation(), client = useAIRequest()
  const initial = preferences.ai.providers.find(p => p.id === preferences.ai.default?.providerId) ?? preferences.ai.providers[0]
  const initialKind = initial?.baseURL.includes('api.openai.com') ? 'openai' : initial && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(initial.baseURL) ? 'local' : initial ? 'custom' : 'openai'
  const [kind, setKind] = useState(initialKind), [providerId, setProviderId] = useState(initial?.id ?? 'onboarding-openai')
  const [endpoint, setEndpoint] = useState(initial?.baseURL ?? 'https://api.openai.com/v1'), [key, setKey] = useState('')
  const [model, setModel] = useState(initial?.defaultModel ?? ''), [selected, setSelected] = useState(initial?.models ?? [])
  const [discovered, setDiscovered] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [tested, setTested] = useState(false), [configured, setConfigured] = useState(Boolean(preferences.ai.default))
  const [choice, setChoice] = useState(preferences.ai.default)
  const lock = useRef(false)
  const valid = (() => { try {
    const url = new URL(endpoint), local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return (url.protocol === 'https:' || (url.protocol === 'http:' && local)) && !url.username && !url.password && !url.search && !url.hash
  } catch { return false } })()
  const ready = Boolean(valid && model.trim() && !/[\s\x00-\x1f]/.test(model.trim()))
  function changeProvider(value: string) {
    setKind(value); setProviderId(`onboarding-${value}`); setEndpoint(value === 'openai' ? 'https://api.openai.com/v1' : value === 'local' ? 'http://127.0.0.1:1234/v1' : '')
    setKey(''); setModel(''); setSelected([]); setDiscovered([]); setTested(false); setError('')
  }
  function editEndpoint(value: string) { setEndpoint(value); setDiscovered([]); setTested(false); setError('') }
  function editModel(value: string) { setModel(value); setTested(false); setError('') }
  async function persist(requireModel: boolean) {
    if (!valid || (requireModel && !ready)) throw new Error(t($ => $.onboarding.invalidModel))
    const latest = await data.settings.get({})
    if (!latest.ok) throw new Error(t($ => $.settings.loadFailed))
    const secret = await data.secrets.hasProviderKey({ provider: providerId })
    if (!secret.ok) throw new Error(t($ => $.settings.loadFailed))
    const previous = latest.value.ai.providers.find(p => p.id === providerId)
    const models = [...new Set([...selected, ...(model.trim() ? [model.trim()] : [])])]
    const provider = { id: providerId, name: previous?.name || (kind === 'local' ? 'Local model' : kind === 'custom' ? 'Custom endpoint' : 'OpenAI'),
      baseURL: endpoint.trim(), requiresKey: Boolean(key.trim() || secret.value.configured), models, defaultModel: model.trim(),
      ...(previous?.capabilities ? { capabilities: Object.fromEntries(Object.entries(previous.capabilities).filter(([id]) => models.includes(id))) } : {}) }
    const providers = previous ? latest.value.ai.providers.map(p => p.id === providerId ? provider : p) : [...latest.value.ai.providers, provider]
    const choice = model.trim() ? { providerId, modelId: model.trim() } : null
    const saved = await data.settings.savePreferences({ ai: { ...latest.value.ai, providers, default: choice ?? latest.value.ai.default } })
    if (!saved.ok) throw new Error(t($ => $.settings.invalidAI))
    if (key.trim()) {
      const result = await data.secrets.saveProviderKey({ provider: providerId, apiKey: key.trim() })
      if (!result.ok) throw new Error(t($ => result.error === 'ENCRYPTION_UNAVAILABLE' ? $.settings.encryptionUnavailable : $.settings.saveFailed))
      setKey('')
    }
    if (choice) { setConfigured(true); setChoice(choice) }
    return choice
  }
  async function run(operation: 'discover' | 'test' | 'save'): Promise<boolean> {
    if (lock.current) return false
    lock.current = true; setBusy(true); setError(''); setTested(false)
    try {
      const choice = await persist(operation !== 'discover')
      if (operation === 'discover') {
        const result = await ai.listModels({ providerId })
        if (!result.ok) throw new Error(t($ => $.ai.errors[result.error]))
        setDiscovered(result.value)
        if (!model && result.value.length) { setModel(result.value[0]); setSelected([result.value[0]]) }
      } else if (operation === 'test' && choice && client.current) {
        const result = await new Promise<{ ok: boolean; error?: string }>(async resolve => {
          try {
            const start = await client.current!.start({ choice, messages: [{ role: 'user', content: 'Reply with OK.' }] }, event => {
              if (event.type === 'completed') resolve({ ok: true })
              if (event.type === 'failed' || event.type === 'cancelled') resolve({ ok: false, error: event.type === 'failed' ? t($ => $.ai.errors[event.error]) : t($ => $.ai.errors.AI_CANCELLED) })
            })
            if (!start.ok) resolve({ ok: false, error: t($ => $.ai.errors[start.error]) })
          } catch { resolve({ ok: false, error: t($ => $.settings.saveFailed) }) }
        })
        if (!result.ok) throw new Error(result.error)
        setTested(true)
      }
      return true
    } catch (reason) { setError(reason instanceof Error ? reason.message : t($ => $.settings.saveFailed)); return false }
    finally { lock.current = false; setBusy(false) }
  }
  function toggle(id: string, enabled: boolean) {
    setSelected(current => enabled ? [...new Set([...current, id])] : current.filter(item => item !== id))
    if (enabled && !model) setModel(id)
    if (!enabled && model === id) setModel(selected.find(item => item !== id) ?? '')
    setTested(false)
  }
  return { kind, changeProvider, endpoint, editEndpoint, key, editKey: (value: string) => { setKey(value); setTested(false) }, model, editModel,
    selected, discovered, busy, ready, valid, error, tested, configured, choice, run, toggle }
}
