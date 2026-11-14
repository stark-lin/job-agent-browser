import { useSyncExternalStore, type ReactNode } from 'react'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import { useServices } from './providers'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { navigation } = useServices()
  const theme = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot).browser.theme
  return <Theme theme={neutralTheme} mode={theme ?? 'system'}>{children}</Theme>
}
