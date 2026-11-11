import { fail } from '../../domain/common/errors'
import { aiPreferences, aiProvider, apiKey, modelId } from './ai-preferences'
import type { createPreferences } from './preferences'
import type { createSecrets } from './secrets'
import { object } from './validation'

export function saveAIConnection(preferences: ReturnType<typeof createPreferences>, secrets: ReturnType<typeof createSecrets>, input: unknown) {
  const args = object(input, ['provider', 'modelId', 'apiKey'])
  const provider = aiProvider(args.provider), model = modelId(args.modelId)
  const key = args.apiKey === undefined ? '' : apiKey(args.apiKey)
  const current = preferences.get({}).ai
  const previous = current.providers.find(entry => entry.id === provider.id)
  if (!key && previous && new URL(previous.baseURL).origin !== new URL(provider.baseURL).origin
    && secrets.hasProviderKey({ provider: provider.id }).configured) fail('INVALID_INPUT')
  const providers = previous ? current.providers.map(entry => entry.id === provider.id ? provider : entry) : [...current.providers, provider]
  const ai = aiPreferences({ providers, default: { providerId: provider.id, modelId: model } })
  const save = () => preferences.savePreferences({ ai })
  return key ? secrets.saveConnectionKey({ provider: provider.id, apiKey: key }, save) : save()
}
