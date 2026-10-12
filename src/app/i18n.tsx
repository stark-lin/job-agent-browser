import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { useServices } from './providers'
import { I18nextProvider } from 'react-i18next'
import { i18n } from '../shared/i18n'

export function TranslationProvider({ children }: { children: ReactNode }) {
  const { navigation } = useServices()
  const language = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot).browser.language
  useEffect(() => { if (language) void i18n.changeLanguage(language) }, [language])
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
