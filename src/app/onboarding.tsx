import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from './providers'
import { useNativePresentation } from './navigation/useNativePresentation'
import { Button, StatusMessage } from '../shared/ui'
import { OnboardingPage } from '../pages/onboarding/OnboardingPage'
import type { Preferences } from '../shared/settings'

const OnboardingContext = createContext<{ restart(): Promise<void> } | null>(null)
export const useOnboarding = () => useContext(OnboardingContext)!

export function OnboardingGate({ children }: { children: ReactNode }) {
  const { data } = useServices(), { t } = useTranslation()
  const [preferences, setPreferences] = useState<Preferences | null>(null), [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0), lock = useRef(false)
  useEffect(() => {
    let alive = true
    setError(false)
    void data.settings.get({}).then(result => {
      if (alive) { if (result.ok) setPreferences(result.value); else setError(true) }
    }).catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [data, attempt])
  async function restart() {
    if (lock.current) return
    lock.current = true
    try {
      const result = await data.settings.savePreferences({ onboardingCompleted: false })
      if (!result.ok) throw new Error(result.error)
      setPreferences(result.value)
    } finally { lock.current = false }
  }
  if (!preferences) return <main className="feature-page"><StatusMessage tone={error ? 'error' : 'neutral'}>{t($ => error ? $.settings.loadFailed : $.settings.loading)}</StatusMessage>
    {error && <Button onClick={() => setAttempt(value => value + 1)}>{t($ => $.settings.retry)}</Button>}</main>
  return <OnboardingContext.Provider value={{ restart }}>{preferences.onboardingCompleted ? children
    : <Setup preferences={preferences} onComplete={setPreferences} />}</OnboardingContext.Provider>
}
function Setup({ preferences, onComplete }: { preferences: Preferences; onComplete(value: Preferences): void }) {
  useNativePresentation(false)
  return <OnboardingPage preferences={preferences} onComplete={onComplete} />
}
