import { fail } from '../../domain/common/errors'
import { object } from './preferences'
import { readJSON, writeJSON } from './files'

export interface KeyProtection {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

export function createSecrets(path: string, protection: KeyProtection) {
  function load(): string | null {
    const stored = readJSON(path)
    if (stored === undefined) return null
    const value = object(stored, ['version', 'openai'])
    if (value.version !== 1 || (value.openai !== null && (typeof value.openai !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.openai)))) return fail('STORAGE_UNAVAILABLE')
    return value.openai as string | null
  }
  function provider(input: unknown, keys = ['provider']) {
    const value = object(input, keys)
    if (value.provider !== 'openai') return fail('INVALID_INPUT')
    return value
  }
  function status() { return { configured: load() !== null, available: protection.available() } }
  return {
    hasProviderKey(input: unknown) { provider(input); return status() },
    saveProviderKey(input: unknown) {
      const value = provider(input, ['provider', 'apiKey'])
      if (typeof value.apiKey !== 'string' || !value.apiKey.trim() || value.apiKey.length > 4096 || /\s/.test(value.apiKey.trim())) return fail('INVALID_INPUT')
      if (!protection.available()) return fail('ENCRYPTION_UNAVAILABLE')
      load() // Refuse to replace an unreadable or unsupported existing file.
      writeJSON(path, { version: 1, openai: protection.encrypt(value.apiKey.trim()).toString('base64') })
      return status()
    },
    deleteProviderKey(input: unknown) { provider(input); load(); writeJSON(path, { version: 1, openai: null }); return status() }
  }
}
