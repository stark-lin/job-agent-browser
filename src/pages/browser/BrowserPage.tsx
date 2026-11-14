import { EmptyState, Icon } from '@astryxdesign/core'
import { useTranslation } from 'react-i18next'
import { useNavigation } from '../../app/navigation/navigate'
import { useNativePresentation } from '../../app/navigation/useNativePresentation'
import { useServices } from '../../app/providers'
import { BrowserControls } from './BrowserControls'
import { TabStrip } from './TabStrip'

export function BrowserPage() {
  const { t } = useTranslation()
  const { navigation } = useServices()
  const { state, active, error, navigate, back, forward, reload, createTab, activateTab, closeTab } = useNavigation()
  useNativePresentation()

  if (!active) return null
  const message = error || active.error
  return (
    <main className="workspace">
      <TabStrip tabs={state.tabs} activeTabId={state.activeTabId}
        onCreate={() => void createTab()} onActivate={(id) => void activateTab(id)} onClose={(id) => void closeTab(id)} />
      <BrowserControls key={active.id} state={active} error={message} onNavigate={navigate} browser={navigation.api}
        onBack={() => void back()} onForward={() => void forward()} onReload={() => void reload()} />
      {!active.url ? <section className="new-tab-page">
        <EmptyState headingLevel={1} title={t($ => $.browser.emptyHeading)} description={t($ => $.browser.emptyDescription)} icon={<Icon icon="externalLink" />} />
        {message ? <p className="error-message" role="alert">{message}</p> : null}
      </section> : null}
    </main>
  )
}
