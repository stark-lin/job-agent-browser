import { fail } from '../../domain/common/errors'
import type { AISettings, AIProvider, ModelOverride } from '../../shared/ai'
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
export function apiKey(input: unknown): string {
  if (typeof input !== 'string' || input.length > 4096 || /\s/.test(input.trim())) return fail('INVALID_INPUT')
  return input.trim()
}

function tokenLimit(input: unknown): number | undefined {
  if (input === undefined) return undefined
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1 || input > 100_000_000) return fail('INVALID_INPUT')
  return input
}

export function aiProvider(input: unknown, legacy = false): AIProvider {
  const p = object(input, ['id', 'name', 'baseURL', 'models', 'overrides', ...(legacy ? ['requiresKey', 'defaultModel', 'parallelModels', 'capabilities'] : [])])
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100 || !Array.isArray(p.models) || p.models.length > 100) return fail('INVALID_INPUT')
  const models = p.models.map(modelId)
  if (new Set(models).size !== models.length) return fail('INVALID_INPUT')
  const overrides: Record<string, ModelOverride> = Object.create(null)
  const configured = p.overrides ?? p.capabilities
  if (configured !== undefined) {
    for (const [id, raw] of Object.entries(object(configured, models))) {
      const old = p.overrides === undefined
      const c = object(raw, old ? ['contextWindow', 'maxOutputTokens', 'source', 'verified'] : ['contextWindow', 'maxOutputTokens'])
      if (old && c.source !== 'manual') continue
      const contextWindow = tokenLimit(c.contextWindow), maxOutputTokens = tokenLimit(c.maxOutputTokens)
      if (contextWindow && maxOutputTokens && maxOutputTokens > contextWindow) return fail('INVALID_INPUT')
      if (contextWindow || maxOutputTokens) overrides[id] = { ...(contextWindow ? { contextWindow } : {}), ...(maxOutputTokens ? { maxOutputTokens } : {}) }
    }
  }
  return { id: providerId(p.id), name: p.name.trim(), baseURL: baseURL(p.baseURL), models, ...(Object.keys(overrides).length ? { overrides } : {}) }
}

export function aiPreferences(input: unknown, legacy = false): AISettings {
  const value = object(input, ['providers', 'default', ...(legacy ? ['timeouts'] : [])])
  if (!Array.isArray(value.providers) || value.providers.length > 20) return fail('INVALID_INPUT')
  const providers = value.providers.map(entry => aiProvider(entry, legacy))
  if (new Set(providers.map(p => p.id)).size !== providers.length) return fail('INVALID_INPUT')
  if (value.default === null) return { providers, default: null }
  const choice = object(value.default, ['providerId', 'modelId']), id = providerId(choice.providerId), model = modelId(choice.modelId)
  if (!providers.some(p => p.id === id && p.models.includes(model))) return fail('INVALID_INPUT')
  return { providers, default: { providerId: id, modelId: model } }
}
