import type { InitOptions } from 'i18next'
import { en } from './locales/en'

export const resources = { en: { translation: en } } as const

export const translationOptions = {
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: ['en'],
  defaultNS: 'translation',
  initAsync: false,
  // All callers render plain text; React escapes interpolated values itself.
  interpolation: { escapeValue: false }
} satisfies InitOptions
