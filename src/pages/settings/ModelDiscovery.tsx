import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import { Button, FormField, Select, StatusMessage } from '../../shared/ui'
import type { AIError } from '../../shared/ai'
import type { useSettings } from './useSettings'

export function ModelDiscovery({ settings: s, busy }: { settings: ReturnType<typeof useSettings>; busy: boolean }) {
  const { t } = useTranslation(), { ai } = useServices()
  const [models, setModels] = useState<string[] | null>(null), [pending, setPending] = useState(false)
  const [error, setError] = useState<AIError | null>(null), mounted = useRef(true), inFlight = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const p = s.provider
  if (!p) return null
  async function detect() {
    if (!p || inFlight.current) return
    inFlight.current = true; setPending(true); setError(null); setModels(null)
    try {
      const result = await ai.listModels({ providerId: p.id })
      if (!mounted.current) return
      if (result.ok) setModels(result.value)
      else setError(result.error)
    } catch { if (mounted.current) setError('AI_CONNECT_FAILED') }
    finally { inFlight.current = false; if (mounted.current) setPending(false) }
  }
  return <>
    <StatusMessage>{t($ => $.settings.detectModelsHelp)}</StatusMessage>
    <Button disabled={busy || pending || s.aiDirty || Boolean(s.key) || !s.providerSaved} onClick={() => void detect()}>{pending ? t($ => $.settings.detectingModels) : t($ => $.settings.detectModels)}</Button>
    {models && (models.length ? <FormField label={t($ => $.settings.detectedModels)} help={t($ => $.settings.modelsDetected, { count: models.length })}>{props => <Select {...props} value="" disabled={busy || pending || p.models.filter(Boolean).length >= 100} onChange={event => {
      const id = event.target.value
      if (id && !p.models.includes(id)) s.editProvider({ models: [...p.models.filter(Boolean), id] })
    }}>
      <option value="">{t($ => $.settings.selectDetectedModel)}</option>
      {models.map(id => <option key={id} value={id} disabled={p.models.includes(id)}>{id}</option>)}
    </Select>}</FormField> : <StatusMessage>{t($ => $.settings.noModelsDetected)}</StatusMessage>)}
    {error && <StatusMessage tone="error">{t($ => $.ai.errors[error])}</StatusMessage>}
  </>
}
