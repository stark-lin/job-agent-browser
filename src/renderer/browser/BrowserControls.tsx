import type { BrowserState } from '@shared/browser'
import { AddressBar } from './AddressBar'

interface BrowserControlsProps {
  state: BrowserState
  error: string
  onNavigate: (input: string) => Promise<void>
}

export function BrowserControls({ state, error, onNavigate }: BrowserControlsProps) {
  return (
    <header className="browser-controls">
      <div className="history-controls">
        <button
          className="icon-button"
          type="button"
          aria-label="Go back"
          title="Back"
          disabled={!state.canGoBack}
          onClick={() => void window.browser.back()}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.1 4.7 3 10l5.1 5.3M3.5 10h7.8a5.2 5.2 0 0 1 5.2 5.2" /></svg>
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Go forward"
          title="Forward"
          disabled={!state.canGoForward}
          onClick={() => void window.browser.forward()}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m11.9 4.7 5.1 5.3-5.1 5.3M16.5 10H8.7a5.2 5.2 0 0 0-5.2 5.2" /></svg>
        </button>
      </div>
      <AddressBar url={state.url} isLoading={state.isLoading} error={error} onNavigate={onNavigate} />
    </header>
  )
}
