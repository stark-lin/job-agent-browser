import { useEffect, useState, useSyncExternalStore } from 'react'
import { useServices } from '../../app/providers'
import type { AISettings } from '../../shared/ai'
export function useAskAgent() {
  const { ask, data } = useServices(), state = useSyncExternalStore(ask.subscribe, ask.getSnapshot)
  const [config, setConfig] = useState<AISettings | null>(null)
  useEffect(() => {
    let current = true
    void data.settings.get({}).then(result => { if (current && result.ok) setConfig(result.value.ai); else if (current && !result.ok) ask.error(result.error) }).catch(() => { if (current) ask.error('STORAGE_UNAVAILABLE') })
    return () => { current = false }
  }, [ask, data])
  const id = state.activeId, session = state.sessions.find(s => s.id === id), key = id ?? 'draft'
  const choice = state.choices[key] ?? (session ? { providerId: session.providerId, modelId: session.modelId } : config?.default) ?? null
  const valid = Boolean(choice && config?.providers.some(p => p.id === choice.providerId && p.models.includes(choice.modelId)))
  const runs = id ? state.runs[id] ?? [] : [], active = runs.find(r => r.state === 'running')
  return { ask, state, id, key, session, choice, valid, config, active, runs, text: state.drafts[key] ?? '', items: id ? state.items[id] ?? [] : [] }
}
