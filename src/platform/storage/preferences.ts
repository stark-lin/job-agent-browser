import { SMART_PASTE_CONFIG_LIMIT, SMART_PASTE_PROMPT_LIMIT, SMART_PASTE_TITLE_LIMIT, type SmartPasteSettings } from '../../shared/smart-paste'
import { knowledgePreferences } from './knowledge-preferences'
import { fail } from '../../domain/common/errors'
import { defaultPreferences, type Mailbox, type Preferences } from '../../shared/settings'
import { readJSON, writeJSON } from './files'
import { object } from './validation'
import { aiPreferences } from './ai-preferences'

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

function smartPaste(input: unknown): SmartPasteSettings {
  const { configs } = object(input, ['configs'])
  if (!Array.isArray(configs) || configs.length > SMART_PASTE_CONFIG_LIMIT) return fail('INVALID_INPUT')
  const ids = new Set<string>()
  return { configs: configs.map(input => {
    const { id, title, prompt } = object(input, ['id', 'title', 'prompt'])
    if (typeof id !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id) || ids.has(id)
      || typeof title !== 'string' || !title.trim() || title.length > SMART_PASTE_TITLE_LIMIT || /[\x00-\x1f]/.test(title)
      || typeof prompt !== 'string' || !prompt.trim() || prompt.length > SMART_PASTE_PROMPT_LIMIT || prompt.includes('\0')) return fail('INVALID_INPUT')
    ids.add(id)
    return { id, title: title.trim(), prompt: prompt.trim() }
  }) }
}

function merge(input: unknown, current: Preferences): Preferences {
  const value = object(input, ['language', 'theme', 'mailbox', 'ai', 'knowledge', 'smartPaste', 'onboardingCompleted'])
  if ('onboardingCompleted' in value && typeof value.onboardingCompleted !== 'boolean') return fail('INVALID_INPUT')
  if ('language' in value && value.language !== 'en' && value.language !== 'zh-CN') return fail('INVALID_INPUT')
  if ('theme' in value && value.theme !== 'light' && value.theme !== 'dark' && value.theme !== 'system') return fail('INVALID_INPUT')
  return { ...current, ...('onboardingCompleted' in value ? { onboardingCompleted: value.onboardingCompleted as boolean } : {}), ...('smartPaste' in value ? { smartPaste: smartPaste(value.smartPaste) } : {}), ...('knowledge' in value ? { knowledge: knowledgePreferences(value.knowledge) } : {}), language: 'language' in value ? value.language as Preferences['language'] : current.language,
    theme: 'theme' in value ? value.theme as Preferences['theme'] : current.theme,
    mailbox: 'mailbox' in value ? mailbox(value.mailbox) : current.mailbox,
    ai: 'ai' in value ? aiPreferences(value.ai) : structuredClone(current.ai) }
}

export function createPreferences(path: string, onSaved: (value: Preferences) => void = () => {}) {
  function load(): Preferences {
    try {
      const stored = readJSON(path)
      if (stored === undefined) return structuredClone(defaultPreferences)
      const value = object(stored, ['version', 'theme', 'language', 'mailbox', 'ai', 'knowledge', 'smartPaste', 'onboardingCompleted'])
      if (value.version !== 1 || !('theme' in value) || !('language' in value) || !('mailbox' in value)) return fail('STORAGE_UNAVAILABLE')
      return merge({ ...('onboardingCompleted' in value ? { onboardingCompleted: value.onboardingCompleted } : {}), theme: value.theme, language: value.language, mailbox: value.mailbox, ...('ai' in value ? { ai: value.ai } : {}), ...('knowledge' in value ? { knowledge: knowledgePreferences(value.knowledge, true) } : {}), ...('smartPaste' in value ? { smartPaste: value.smartPaste } : {}) }, defaultPreferences)
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
