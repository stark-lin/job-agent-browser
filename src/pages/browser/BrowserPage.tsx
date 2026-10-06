import { useEffect } from 'react'
import { useNavigation } from '../../app/navigation/navigate'
import { useServices } from '../../app/providers'
import { BrowserControls } from './BrowserControls'
import { TabStrip } from './TabStrip'

export function BrowserPage() {
  const { state, active, error, navigate, back, forward, openPage, createTab, activateTab, closeTab } = useNavigation()
  const { navigation } = useServices()
  const tabId = active?.id, targetId = active?.targetId
  useEffect(() => {
    if (!tabId || !targetId) return
    const presentation = { tabId, targetId }
    void navigation.run(() => navigation.api.setVisible(true, presentation))
    return () => { void navigation.api.setVisible(false, presentation).catch(() => {}) }
    // Only target changes require a presentation handshake, not title/loading updates.
  }, [navigation, tabId, targetId])

  if (!active) return null
  const message = error || active.error
  return (
    <main className="workspace">
      <TabStrip tabs={state.tabs} activeTabId={state.activeTabId}
        onCreate={() => void createTab()} onActivate={(id) => void activateTab(id)} onClose={(id) => void closeTab(id)} />
      <BrowserControls key={active.id} state={active} error={message} onNavigate={navigate}
        onBack={() => void back()} onForward={() => void forward()} onHome={() => void openPage('home')} />
      {!active.url ? <section className="new-tab-page">
        <div className="new-tab-icon" aria-hidden="true">↗</div>
        <h1>Start exploring</h1><p>Search for anything or enter a web address above.</p>
        {message ? <p className="error-message" role="alert">{message}</p> : null}
      </section> : null}
    </main>
  )
}
