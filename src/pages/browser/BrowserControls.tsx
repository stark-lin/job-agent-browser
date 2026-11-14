import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react'
import { Icon, IconButton, Text } from '@astryxdesign/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BrowserAPI, BrowserTabState } from '@shared/browser'
import { AddressBar } from './AddressBar'

interface BrowserControlsProps {
  state: BrowserTabState
  error: string
  onNavigate: (input: string) => Promise<void>
  onBack: () => void
  onForward: () => void
  onReload: () => void
  browser: Pick<BrowserAPI, 'copyWebpage' | 'onCopyWebpageResult'>
}

export function BrowserControls({ state, error, onNavigate, onBack, onForward, onReload, browser }: BrowserControlsProps) {
  const { t } = useTranslation()
  return (
    <header className="browser-controls">
      <div className="history-controls">
        <IconButton className="icon-button" size="sm" variant="ghost" label={t($ => $.browser.back)}
          icon={<Icon icon={ArrowLeft} />} tooltip={t($ => $.browser.back)} isDisabled={!state.canGoBack} onClick={onBack} />
        <IconButton className="icon-button" size="sm" variant="ghost" label={t($ => $.browser.forward)}
          icon={<Icon icon={ArrowRight} />} tooltip={t($ => $.browser.forward)} isDisabled={!state.canGoForward} onClick={onForward} />
        <IconButton className="icon-button" size="sm" variant="ghost" label={t($ => $.browser.refresh)}
          icon={<Icon icon={RotateCw} />} tooltip={t($ => $.browser.refresh)} isDisabled={!state.url || state.isLoading} onClick={onReload} />
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
    <IconButton className="icon-button" size="sm" variant="ghost" label={label} tooltip={label} aria-busy={copying}
      icon={<Icon icon={copied ? 'check' : 'copy'} />} isDisabled={disabled || copying} onClick={() => void copyWebpage()} />
    <Text as="p" type="supporting" role="status">{copied && t($ => $.browser.copied)}</Text>
    {copied === false && <div className="navigation-error" role="alert" title={failure}>{failure}</div>}
  </>
}
