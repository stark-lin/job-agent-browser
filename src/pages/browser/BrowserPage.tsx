import { useTranslation } from 'react-i18next'
import { useNavigation } from '../../app/navigation/navigate'
import { useNativePresentation } from '../../app/navigation/useNativePresentation'
import { useServices } from '../../app/providers'
import { BrowserControls } from './BrowserControls'
import { TabStrip } from './TabStrip'
import { Icon, IconBox } from '../../shared/ui'

export function BrowserPage() {
  const { t } = useTranslation()
  const { navigation } = useServices()
  const { state, active, error, navigate, back, forward, reload, openPage, createTab, activateTab, closeTab } = useNavigation()
  useNativePresentation()

  if (!active) return null
  const message = error || active.error
  return (
    <main className="workspace">
      <TabStrip tabs={state.tabs} activeTabId={state.activeTabId}
        onCreate={() => void createTab()} onActivate={(id) => void activateTab(id)} onClose={(id) => void closeTab(id)} />
      <BrowserControls key={active.id} state={active} error={message} onNavigate={navigate} browser={navigation.api}
        onBack={() => void back()} onForward={() => void forward()} onReload={() => void reload()} onHome={() => void openPage('home')} />
      {!active.url ? <section className="new-tab-page">
        <IconBox size="md" tone="primary" aria-hidden="true">
          <Icon><path d="M7 17 17 7M7 7h10v10" /></Icon>
        </IconBox>
        <h1>{t($ => $.browser.emptyHeading)}</h1><p>{t($ => $.browser.emptyDescription)}</p>
        {message ? <p className="error-message" role="alert">{message}</p> : null}
      </section> : null}
    </main>
  )
}
