import { useSyncExternalStore } from 'react'
import { useServices } from '../providers'
import type { InternalPage } from '../../shared/navigation'

export function useNavigation() {
  const { navigation } = useServices()
  const snapshot = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
  const state = snapshot.browser
  const active = state.tabs.find((tab) => tab.id === state.activeTabId)
  const error = snapshot.error
  return {
    state, active,
    error: error && (!error.tabId || (error.tabId === active?.id && error.targetId === active.targetId)) ? error.message : '',
    run: (action: () => Promise<void>) => navigation.run(action),
    navigate: (input: string) => navigation.run(() => navigation.api.navigate(input)),
    openPage: (page: InternalPage) => navigation.run(() => navigation.api.navigate(`app://${page}`)),
    back: () => navigation.run(() => navigation.api.back()),
    forward: () => navigation.run(() => navigation.api.forward()),
    createTab: () => navigation.run(() => navigation.api.createTab()),
    activateTab: (id: string) => navigation.run(() => navigation.api.activateTab(id)),
    closeTab: (id: string) => navigation.run(() => navigation.api.closeTab(id))
  }
}
