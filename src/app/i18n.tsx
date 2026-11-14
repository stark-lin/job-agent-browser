import { InternationalizationProvider } from '@astryxdesign/core/i18n'
import zhCN from '@astryxdesign/core/locales/zh-CN.generated.js'
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { useServices } from './providers'
import { I18nextProvider } from 'react-i18next'
import { i18n } from '../shared/i18n'

const messages = { 'zh-CN': zhCN }
const subscribeLanguage = (listener: () => void) => {
  i18n.on('languageChanged', listener)
  return () => { i18n.off('languageChanged', listener) }
}
const getLanguage = () => i18n.resolvedLanguage ?? 'en'

export function TranslationProvider({ children }: { children: ReactNode }) {
  const { navigation } = useServices()
  const language = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot).browser.language
  const locale = useSyncExternalStore(subscribeLanguage, getLanguage)
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
  return <I18nextProvider i18n={i18n}><InternationalizationProvider locale={locale} messages={messages}>{children}</InternationalizationProvider></I18nextProvider>
}
