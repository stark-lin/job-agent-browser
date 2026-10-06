import { t } from '../shared/i18n'
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { BrowserAPI } from '../shared/browser'
import type { DataAPI } from '../platform/electron/data-contract'
import { NavigationStore } from './navigation/navigationStore'
import { ContextStore } from './context/contextStore'
import type { AppContext } from './context/appContext'

interface Services { navigation: NavigationStore; context: ContextStore; data: DataAPI }
const ServicesContext = createContext<Services | null>(null)

export function AppProviders({ children, browser = window.browser, data = window.data }: {
  children: ReactNode; browser?: BrowserAPI; data?: DataAPI
}) {
  const [services] = useState<Services>(() => ({ navigation: new NavigationStore(browser), context: new ContextStore(), data }))
  useEffect(() => services.navigation.start(), [services])
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
}

export function useServices(): Services {
  const services = useContext(ServicesContext)
  if (!services) throw new Error(t($ => $.errors.providersUnavailable))
  return services
}

export function useAppContext(): AppContext {
  const { navigation, context } = useServices()
  const { browser } = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
  const references = useSyncExternalStore(context.subscribe, context.getSnapshot)
  const tab = browser.tabs.find((item) => item.id === browser.activeTabId)
  return { ...references, currentPage: tab ? { tabId: tab.id, title: tab.title, destination: tab.destination } : null }
}
