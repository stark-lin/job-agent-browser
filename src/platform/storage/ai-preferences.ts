import { fail } from '../../domain/common/errors'
import { defaultAITimeouts, type AISettings, type AIProvider, type AITimeouts } from '../../shared/ai'
import { object } from './validation'

export function providerId(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(input) || ['__proto__', 'constructor', 'prototype'].includes(input)) return fail('INVALID_INPUT')
  return input
}
export function baseURL(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048) return fail('INVALID_INPUT')
  let url: URL
  try { url = new URL(input.trim()) } catch { return fail('INVALID_INPUT') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) return fail('INVALID_INPUT')
  return url.href.replace(/\/+$/, '')
}
export function modelId(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 200 || /[\s\x00-\x1f]/.test(input)) return fail('INVALID_INPUT')
  return input
}
export function aiPreferences(input: unknown): AISettings {
  const value = object(input, ['providers', 'default', 'timeouts'])
  const timeouts = { ...defaultAITimeouts }
  if ('timeouts' in value) {
    const fields = Object.keys(defaultAITimeouts) as (keyof AITimeouts)[]
    const configured = object(value.timeouts, fields)
    for (const field of fields) {
      const seconds = configured[field]
      if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1 || seconds > 3600) return fail('INVALID_INPUT')
      timeouts[field] = seconds
    }
  }
  if (!Array.isArray(value.providers) || value.providers.length > 20) return fail('INVALID_INPUT')
  const providers = value.providers.map((entry): AIProvider => {
    const p = object(entry, ['id', 'name', 'baseURL', 'requiresKey', 'models', 'defaultModel', 'parallelModels'])
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100 || typeof p.requiresKey !== 'boolean' || !Array.isArray(p.models) || p.models.length > 100) return fail('INVALID_INPUT')
    const models = p.models.map(modelId)
    if (new Set(models).size !== models.length || typeof p.defaultModel !== 'string' || (p.defaultModel !== '' && !models.includes(p.defaultModel))) return fail('INVALID_INPUT')
    const parallelModels = p.parallelModels === undefined ? [] : p.parallelModels
    if (!Array.isArray(parallelModels) || parallelModels.some(model => typeof model !== 'string' || !models.includes(model)) || new Set(parallelModels).size !== parallelModels.length) return fail('INVALID_INPUT')
    return { ...(parallelModels.length ? { parallelModels } : {}), id: providerId(p.id), name: p.name.trim(), baseURL: baseURL(p.baseURL), requiresKey: p.requiresKey, models, defaultModel: p.defaultModel }
  })
  if (new Set(providers.map(p => p.id)).size !== providers.length) return fail('INVALID_INPUT')
  if (value.default === null) return { providers, default: null, timeouts }
  const choice = object(value.default, ['providerId', 'modelId']), id = providerId(choice.providerId), model = modelId(choice.modelId)
  if (!providers.some(p => p.id === id && p.models.includes(model))) return fail('INVALID_INPUT')
  return { providers, default: { providerId: id, modelId: model }, timeouts }
}
