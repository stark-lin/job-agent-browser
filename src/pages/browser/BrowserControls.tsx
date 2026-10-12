import { Icon, IconButton } from '../../shared/ui'
import type { BrowserTabState } from '@shared/browser'
import { AddressBar } from './AddressBar'

interface BrowserControlsProps {
  state: BrowserTabState
  error: string
  onNavigate: (input: string) => Promise<void>
  onHome: () => void
  onBack: () => void
  onForward: () => void
}

export function BrowserControls({ state, error, onNavigate, onHome, onBack, onForward }: BrowserControlsProps) {
  return (
    <header className="browser-controls">
      <div className="history-controls">
        <IconButton className="icon-button" type="button" aria-label="Go home" title="Home" onClick={onHome}>
          <Icon viewBox="0 0 20 20" aria-hidden="true"><path d="m2.5 9 7.5-6.5L17.5 9M4.5 7.5v10h4v-6h3v6h4v-10" /></Icon>
        </IconButton>
        <IconButton
          className="icon-button"
          type="button"
          aria-label="Go back"
          title="Back"
          disabled={!state.canGoBack}
          onClick={onBack}
        >
          <Icon viewBox="0 0 20 20" aria-hidden="true"><path d="M8.1 4.7 3 10l5.1 5.3M3.5 10h7.8a5.2 5.2 0 0 1 5.2 5.2" /></Icon>
        </IconButton>
        <IconButton
          className="icon-button"
          type="button"
          aria-label="Go forward"
          title="Forward"
          disabled={!state.canGoForward}
          onClick={onForward}
        >
          <Icon viewBox="0 0 20 20" aria-hidden="true"><path d="m11.9 4.7 5.1 5.3-5.1 5.3M16.5 10H8.7a5.2 5.2 0 0 0-5.2 5.2" /></Icon>
        </IconButton>
      </div>
      <div className="address-controls">
        <AddressBar url={state.url} isLoading={state.isLoading} error={error} onNavigate={onNavigate} />
        {error ? <div className="navigation-error" role="alert" title={error}>{error}</div> : null}
      </div>
    </header>
  )
}
