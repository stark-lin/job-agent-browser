import { useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'
import { useServices } from './providers'

/** Main owns theme resolution; CSS follows native color preference before the first snapshot. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { navigation } = useServices()
  const theme = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot).browser.theme
  useLayoutEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
  }, [theme])
  return children
}
