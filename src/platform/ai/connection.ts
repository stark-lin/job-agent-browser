import { fail } from '../../domain/common/errors'
import type { AISettings } from '../../shared/ai'
import { aiPreferences, aiProvider, apiKey, baseURL, modelId, providerId, timeoutOverrides } from '../storage/ai-preferences'
import type { createPreferences } from '../storage/preferences'
import type { createSecrets } from '../storage/secrets'
import { object } from '../storage/validation'
import { authenticatedKey } from './transport'

export function saveAIConnection(preferences: ReturnType<typeof createPreferences>, secrets: ReturnType<typeof createSecrets>, input: unknown) {
  const change = object(input, ['removeProviderId', 'provider', 'modelId', 'previousEndpoint', 'apiKey', 'clearKey', 'timeoutOverrides'])
  const current = preferences.get({}).ai
  const previous = change.previousEndpoint === undefined ? undefined : baseURL(change.previousEndpoint)
  const save = (ai: AISettings, id: string, key: string | null | undefined) =>
    preferences.savePreferences({ ai }, key === undefined ? undefined : write => secrets.withProviderKey(id, key, write))
  if ('removeProviderId' in change) {
    const id = providerId(change.removeProviderId)
    if (!current.providers.some(provider => provider.id === id && provider.baseURL === previous)) fail('INVALID_INPUT')
    return save({ ...current, providers: current.providers.filter(provider => provider.id !== id),
      default: current.default?.providerId === id ? null : current.default }, id, null)
  }

  const provider = aiProvider(change.provider)
  const saved = current.providers.find(item => item.id === provider.id)
  if (saved?.baseURL !== previous) fail('INVALID_INPUT')
  const selected = modelId(change.modelId), overrides = 'timeoutOverrides' in change ? timeoutOverrides(change.timeoutOverrides) : current.timeoutOverrides
  if (change.clearKey !== undefined && typeof change.clearKey !== 'boolean' || change.clearKey && change.apiKey !== undefined) fail('INVALID_INPUT')
  const key = change.apiKey === undefined ? undefined : apiKey(change.apiKey)
  const changedEndpoint = saved && saved.baseURL !== provider.baseURL
  const secret = key ?? (!saved || changedEndpoint || change.clearKey ? null : undefined)
  if (provider.authMode === 'bearer') authenticatedKey(provider.authMode, () => secret === undefined && saved ? secrets.readProviderKey(saved.id) : secret ?? null)
  const ai = aiPreferences({
    providers: saved ? current.providers.map(item => item.id === provider.id ? provider : item) : [...current.providers, provider],
    default: { providerId: provider.id, modelId: selected }, ...(overrides ? { timeoutOverrides: overrides } : {})
  })
  return save(ai, provider.id, secret)
}
