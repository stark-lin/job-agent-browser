import { TranslationProvider } from './i18n'
import { AppProviders } from './providers'
import { AppRouter } from './router'
import { ThemeProvider } from './theme'

export function App() {
  return <AppProviders><ThemeProvider><TranslationProvider><AppRouter /></TranslationProvider></ThemeProvider></AppProviders>
}
