import { TranslationProvider } from './i18n'
import { AppProviders } from './providers'
import { AppRouter } from './router'
import { ThemeProvider } from './theme'
import { OnboardingGate } from './onboarding'

export function App() {
  return <AppProviders><ThemeProvider><TranslationProvider><OnboardingGate><AppRouter /></OnboardingGate></TranslationProvider></ThemeProvider></AppProviders>
}
