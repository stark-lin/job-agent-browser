import { useEffect, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { i18n } from '../shared/i18n'

export function TranslationProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const updateDocument = (): void => {
      document.title = i18n.t($ => $.app.title)
      document.documentElement.lang = i18n.resolvedLanguage ?? 'en'
    }
    updateDocument()
    i18n.on('languageChanged', updateDocument)
    return () => { i18n.off('languageChanged', updateDocument) }
  }, [])
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}
