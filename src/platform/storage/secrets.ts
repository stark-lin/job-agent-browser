import { fail } from '../../domain/common/errors'
import { object } from './validation'
import { providerId } from './ai-preferences'
import { readJSON, writeJSON } from './files'

export interface KeyProtection {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

export function createSecrets(path: string, protection: KeyProtection) {
  function load(): Record<string, string> {
    const stored = readJSON(path)
    if (stored === undefined) return Object.create(null) as Record<string, string>
    try {
      const version = (stored as { version?: unknown } | null)?.version
      const value = object(stored, version === 1 ? ['version', 'openai'] : ['version', 'providers'])
      if (version !== 1 && version !== 2) return fail('STORAGE_UNAVAILABLE')
      const entries = version === 1 ? (value.openai === null ? {} : { openai: value.openai }) : value.providers
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return fail('STORAGE_UNAVAILABLE')
      const result: Record<string, string> = Object.create(null) as Record<string, string>
      for (const [id, ciphertext] of Object.entries(entries)) {
        providerId(id)
        if (typeof ciphertext !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) return fail('STORAGE_UNAVAILABLE')
        result[id] = ciphertext
      }
      return result
    } catch { return fail('STORAGE_UNAVAILABLE') }
  }
  function provider(input: unknown, keys = ['provider']): Record<string, unknown> & { provider: string } {
    const value = object(input, keys)
    return { ...value, provider: providerId(value.provider) }
  }
  function status(id: string) { return { configured: Object.hasOwn(load(), id), available: protection.available() } }
  return {
    hasProviderKey(input: unknown) { return status(provider(input).provider) },
    saveProviderKey(input: unknown) {
      const value = provider(input, ['provider', 'apiKey'])
      if (typeof value.apiKey !== 'string' || !value.apiKey.trim() || value.apiKey.length > 4096 || /\s/.test(value.apiKey.trim())) return fail('INVALID_INPUT')
      if (!protection.available()) return fail('ENCRYPTION_UNAVAILABLE')
      const providers = load()
      providers[value.provider] = protection.encrypt(value.apiKey.trim()).toString('base64')
      writeJSON(path, { version: 2, providers })
      return status(value.provider)
    },
    deleteProviderKey(input: unknown) {
      const id = provider(input).provider, providers = load()
      delete providers[id]
      writeJSON(path, { version: 2, providers })
      return status(id)
    },
    // Main-only: explicitly excluded from the data-contract allowlist and preload bridge.
    readProviderKey(id: string): string | null {
      providerId(id)
      const ciphertext = load()[id]
      if (!ciphertext) return null
      if (!protection.available()) return fail('ENCRYPTION_UNAVAILABLE')
      try { return protection.decrypt(Buffer.from(ciphertext, 'base64')) } catch { return fail('STORAGE_UNAVAILABLE') }
    }
  }
}
