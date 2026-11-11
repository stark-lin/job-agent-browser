import { fail } from '../../domain/common/errors'
import { normalizeAIEndpoint, validModelId, type AISettings, type AIProvider, type AITimeoutOverrides, type ModelOverrides } from '../../shared/ai'
import { object } from './validation'

export function providerId(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(input) || ['__proto__', 'constructor', 'prototype'].includes(input)) return fail('INVALID_INPUT')
  return input
}
export function baseURL(input: unknown): string {
  return (typeof input === 'string' && normalizeAIEndpoint(input)) || fail('INVALID_INPUT')
}
export function modelId(input: unknown): string {
  return validModelId(input) ? input : fail('INVALID_INPUT')
}
export function authMode(input: unknown): AIProvider['authMode'] {
  if (input === undefined || input === 'none' || input === 'bearer') return input
  return fail('INVALID_INPUT')
}
export function apiKey(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 4096 || /[\s\x00-\x1f\x7f]/.test(input.trim())) return fail('INVALID_INPUT')
  return input.trim()
}
function positiveInteger(input: unknown, maximum: number): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1 || input > maximum) return fail('INVALID_INPUT')
  return input
}
export function timeoutSeconds(input: unknown): number {
  return positiveInteger(input, 3600)
}

const legacyTimeouts = { requestSeconds: 120, pageSeconds: 20, modelsSeconds: 15 } as const

export function timeoutOverrides(input: unknown, legacy = false): AITimeoutOverrides | undefined {
  if (input === undefined) return
  const fields = Object.keys(legacyTimeouts) as (keyof AITimeoutOverrides)[]
  const values = object(input, fields), overrides: AITimeoutOverrides = {}
  for (const field of fields) {
    if (values[field] === undefined) continue
    const seconds = timeoutSeconds(values[field])
    if (!legacy || seconds !== legacyTimeouts[field]) overrides[field] = seconds
  }
  return Object.keys(overrides).length ? overrides : undefined
}

function modelOverrides(raw: unknown, legacy: boolean): ModelOverrides {
  const fields = ['contextWindow', 'maxOutputTokens']
  const entry = object(raw, legacy ? [...fields, 'source', 'verified'] : fields)
  if (legacy && entry.source !== 'manual') return {}
  const contextWindow = entry.contextWindow === undefined ? undefined : positiveInteger(entry.contextWindow, 100_000_000)
  const maxOutputTokens = entry.maxOutputTokens === undefined ? undefined : positiveInteger(entry.maxOutputTokens, contextWindow ?? 100_000_000)
  return { ...(contextWindow !== undefined ? { contextWindow } : {}), ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}) }
}

export function aiProvider(input: unknown, legacy = false): AIProvider {
  const fields = ['id', 'name', 'baseURL', 'models', 'authMode', 'overrides']
  const p = object(input, legacy ? [...fields, 'requiresKey', 'defaultModel', 'parallelModels', 'capabilities'] : fields)
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100 || !Array.isArray(p.models) || p.models.length > 10_000) return fail('INVALID_INPUT')
  const models = p.models.map(modelId)
  if (new Set(models).size !== models.length) return fail('INVALID_INPUT')
  const configured = 'overrides' in p ? p.overrides : legacy ? p.capabilities : undefined
  const overrides = configured === undefined ? [] : Object.entries(object(configured, models))
    .map(([id, value]) => [id, modelOverrides(value, p.overrides === undefined)] as const)
    .filter(([, value]) => Object.keys(value).length > 0)
  const mode = authMode(p.authMode)
  return { id: providerId(p.id), name: p.name.trim(), baseURL: baseURL(p.baseURL), models,
    ...(mode ? { authMode: mode } : {}), ...(overrides.length ? { overrides: Object.fromEntries(overrides) } : {}) }
}

export function aiPreferences(input: unknown, legacy = false): AISettings {
  const value = object(input, legacy ? ['providers', 'default', 'timeoutOverrides', 'timeouts'] : ['providers', 'default', 'timeoutOverrides'])
  if (!Array.isArray(value.providers) || value.providers.length > 20) return fail('INVALID_INPUT')
  const providers = value.providers.map(entry => aiProvider(entry, legacy))
  if (new Set(providers.map(p => p.id)).size !== providers.length) return fail('INVALID_INPUT')
  const timeouts = timeoutOverrides('timeoutOverrides' in value ? value.timeoutOverrides : legacy ? value.timeouts : undefined, !('timeoutOverrides' in value))
  const settings: AISettings = { providers, default: null, ...(timeouts ? { timeoutOverrides: timeouts } : {}) }
  if (value.default == null && legacy) {
    for (const [index, entry] of value.providers.entries()) {
      if (!entry.defaultModel || !providers[index].models.includes(entry.defaultModel)) continue
      settings.default = { providerId: providers[index].id, modelId: entry.defaultModel }
      break
    }
  } else if (value.default !== null) {
    const choice = object(value.default, ['providerId', 'modelId']), id = providerId(choice.providerId), model = modelId(choice.modelId)
    if (!providers.some(p => p.id === id && p.models.includes(model))) return fail('INVALID_INPUT')
    settings.default = { providerId: id, modelId: model }
  }
  return settings
}
