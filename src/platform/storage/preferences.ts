import { fail } from '../../domain/common/errors'
import { defaultPreferences, type Mailbox, type Preferences } from '../../shared/settings'
import { readJSON, writeJSON } from './files'

export function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) return fail('INVALID_INPUT')
  return input as Record<string, unknown>
}

export function mailbox(input: unknown): Mailbox {
  const value = object(input, ['provider', 'url'])
  if (!['none', 'gmail', 'outlook', 'custom'].includes(String(value.provider)) || typeof value.url !== 'string') return fail('INVALID_INPUT')
  const provider = value.provider as Mailbox['provider']
  if (provider === 'none') {
    if (value.url !== '') return fail('INVALID_INPUT')
    return { provider, url: '' }
  }
  if (value.url.length > 2048) return fail('INVALID_INPUT')
  let url: URL
  try { url = new URL(value.url.trim()) } catch { return fail('INVALID_INPUT') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return fail('INVALID_INPUT')
  return { provider, url: url.href }
}

function merge(input: unknown, current: Preferences): Preferences {
  const value = object(input, ['language', 'theme', 'mailbox'])
  if ('language' in value && value.language !== 'en' && value.language !== 'zh-CN') return fail('INVALID_INPUT')
  if ('theme' in value && value.theme !== 'light' && value.theme !== 'dark' && value.theme !== 'system') return fail('INVALID_INPUT')
  return { ...current, language: 'language' in value ? value.language as Preferences['language'] : current.language,
    theme: 'theme' in value ? value.theme as Preferences['theme'] : current.theme,
    mailbox: 'mailbox' in value ? mailbox(value.mailbox) : current.mailbox }
}

export function createPreferences(path: string, onSaved: (value: Preferences) => void = () => {}) {
  function load(): Preferences {
    try {
      const stored = readJSON(path)
      if (stored === undefined) return structuredClone(defaultPreferences)
      const value = object(stored, ['version', 'theme', 'language', 'mailbox'])
      if (value.version !== 1 || !('theme' in value) || !('language' in value) || !('mailbox' in value)) return fail('STORAGE_UNAVAILABLE')
      return merge({ theme: value.theme, language: value.language, mailbox: value.mailbox }, defaultPreferences)
    } catch { return fail('STORAGE_UNAVAILABLE') }
  }
  return {
    get(input: unknown): Preferences { object(input, []); return load() },
    savePreferences(input: unknown): Preferences {
      const next = merge(input, load())
      writeJSON(path, next)
      onSaved(structuredClone(next))
      return next
    }
  }
}
