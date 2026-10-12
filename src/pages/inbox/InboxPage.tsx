import { useTranslation } from 'react-i18next'
import { Button, PageHeading, SectionCard, StatusMessage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'
import { useNativePresentation } from '../../app/navigation/useNativePresentation'
import { isInboxDestination } from '../../shared/navigation'
import './inbox.css'

export function InboxPage() {
  const { t } = useTranslation()
  const { active, error, openPage } = useNavigation()
  const configured = Boolean(active && isInboxDestination(active.destination))
  const message = configured ? error || active?.error : ''
  useNativePresentation(configured && !message)
  if (configured && !message) return <main className="inbox-page" aria-label={t($ => $.navigation.pages.inbox)} />
  return <main className="inbox-page inbox-page--message">
    <div className="inbox-message">
      <PageHeading title={t($ => $.navigation.pages.inbox)} />
      <SectionCard title={configured ? t($ => $.inbox.loadFailed) : t($ => $.inbox.configure)}>
        <div className="inbox-message-content">
          <StatusMessage tone={configured ? 'error' : 'neutral'}>{message || t($ => $.inbox.configureHelp)}</StatusMessage>
          <div className="page-actions">
            <Button onClick={() => void openPage('home')}>{configured ? t($ => $.inbox.exit) : t($ => $.navigation.goHome)}</Button>
            {configured && <Button onClick={() => void openPage('inbox')}>{t($ => $.settings.retry)}</Button>}
            <Button variant="primary" onClick={() => void openPage('settings')}>{t($ => $.navigation.openSettings)}</Button>
          </div>
        </div>
      </SectionCard>
    </div>
  </main>
}
