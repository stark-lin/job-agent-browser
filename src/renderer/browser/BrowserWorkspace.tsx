import { useEffect, useState } from 'react'
import type { BrowserState } from '@shared/browser'
import { BrowserControls } from './BrowserControls'

const initialState: BrowserState = {
  url: '',
  canGoBack: false,
  canGoForward: false,
  isLoading: false
}

export function BrowserWorkspace() {
  const [state, setState] = useState(initialState)
  const [error, setError] = useState('')

  useEffect(() => {
    const unsubscribe = window.browser.onStateChange((nextState) => {
      setState(nextState)
      setError('')
    })
    void window.browser.getState().then(setState).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Unable to read browser state.')
    })
    return unsubscribe
  }, [])

  async function navigate(input: string): Promise<void> {
    setError('')
    try {
      await window.browser.navigate(input)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to navigate to that address.')
    }
  }

  return (
    <main className="workspace">
      <BrowserControls state={state} error={error} onNavigate={navigate} />
      <div className="content-placeholder" aria-hidden="true">
        {error ? <span className="error-message">{error}</span> : null}
      </div>
    </main>
  )
}
