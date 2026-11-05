import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon, IconButton, StatusMessage } from '../../shared/ui'
import type { BrowserAPI, BrowserTabState } from '@shared/browser'
import { AddressBar } from './AddressBar'

interface BrowserControlsProps {
  state: BrowserTabState
  error: string
  onNavigate: (input: string) => Promise<void>
  onHome: () => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  browser: Pick<BrowserAPI, 'copyWebpage' | 'onCopyWebpageResult'>
}

export function BrowserControls({ state, error, onNavigate, onHome, onBack, onForward, onReload, browser }: BrowserControlsProps) {
  const { t } = useTranslation()
  return (
    <header className="browser-controls">
      <div className="history-controls">
        <IconButton className="icon-button" type="button" aria-label={t($ => $.navigation.goHome)} title={t($ => $.navigation.goHome)} onClick={onHome}>
          <Icon viewBox="0 0 20 20" aria-hidden="true"><path d="m2.5 9 7.5-6.5L17.5 9M4.5 7.5v10h4v-6h3v6h4v-10" /></Icon>
        </IconButton>
        <IconButton
          className="icon-button"
          type="button"
          aria-label={t($ => $.browser.back)}
          title={t($ => $.browser.back)}
          disabled={!state.canGoBack}
          onClick={onBack}
        >
          <Icon viewBox="0 0 20 20" aria-hidden="true"><path d="m9 4-6 6 6 6M3 10h14" /></Icon>
        </IconButton>
        <IconButton
          className="icon-button"
          type="button"
          aria-label={t($ => $.browser.forward)}
          title={t($ => $.browser.forward)}
          disabled={!state.canGoForward}
          onClick={onForward}
        >
          <Icon viewBox="0 0 20 20" aria-hidden="true"><path d="m11 4 6 6-6 6M3 10h14" /></Icon>
        </IconButton>
        <IconButton className="icon-button" type="button" aria-label={t($ => $.browser.refresh)}
          title={t($ => $.browser.refresh)} disabled={!state.url || state.isLoading} onClick={onReload}>
          <Icon viewBox="0 0 20 20" aria-hidden="true"><path d="M16 7a6.5 6.5 0 1 0 .4 5M16 2v5h-5" /></Icon>
        </IconButton>
      </div>
      <div className="address-controls">
        <AddressBar url={state.url} isLoading={state.isLoading} error={error} onNavigate={onNavigate} />
        <CopyWebpageControl key={JSON.stringify([state.targetId, state.url, state.isLoading, state.error])} state={state} browser={browser} />
        {error ? <div className="navigation-error" role="alert" title={error}>{error}</div> : null}
      </div>
    </header>
  )
}

function CopyWebpageControl({ state, browser }: Pick<BrowserControlsProps, 'state' | 'browser'>) {
  const { t } = useTranslation()
  const { id: tabId, targetId } = state
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState<boolean | null>(null)
  const disabled = !state.url || state.isLoading || Boolean(state.error)

  useEffect(() => browser.onCopyWebpageResult((presentation, success) => {
    if (presentation.tabId === tabId && presentation.targetId === targetId) setCopied(success)
  }), [browser, tabId, targetId])

  useEffect(() => {
    if (copied !== true) return
    const timeout = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(timeout)
  }, [copied])

  async function copyWebpage(): Promise<void> {
    setCopying(true)
    setCopied(null)
    try {
      await browser.copyWebpage()
      setCopied(true)
    } catch {
      setCopied(false)
    } finally {
      setCopying(false)
    }
  }

  const label = t($ => $.browser.copyWebpage)
  const failure = t($ => $.browser.copyFailed)
  return <>
    <IconButton className="icon-button" aria-label={label} title={label} aria-busy={copying}
      disabled={disabled || copying} onClick={() => void copyWebpage()}>
      <Icon viewBox="0 0 20 20"><path d={copied ? 'm4 10 4 4 8-8' : 'M6 6V3h11v11h-3M3 6h11v11H3z'} /></Icon>
    </IconButton>
    <StatusMessage>{copied && t($ => $.browser.copied)}</StatusMessage>
    {copied === false && <div className="navigation-error" role="alert" title={failure}>{failure}</div>}
  </>
}
