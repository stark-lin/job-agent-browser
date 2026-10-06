import { TranslationProvider } from './i18n'
import { AppProviders } from './providers'
import { AppRouter } from './router'

export function App() {
  return <TranslationProvider><AppProviders><AppRouter /></AppProviders></TranslationProvider>
}
