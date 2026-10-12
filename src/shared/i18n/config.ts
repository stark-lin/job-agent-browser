import type { InitOptions } from 'i18next'
import { en } from './locales/en'
import { zhCN } from './locales/zh-CN'

export const resources = { en: { translation: en }, 'zh-CN': { translation: zhCN } } as const

export const translationOptions = {
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: ['en', 'zh-CN'],
  defaultNS: 'translation',
  initAsync: false,
  // All callers render plain text; React escapes interpolated values itself.
  interpolation: { escapeValue: false }
} satisfies InitOptions
