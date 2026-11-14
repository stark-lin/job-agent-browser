import { Button, Heading, Section, Stack, Text } from '@astryxdesign/core'
import { useTranslation } from 'react-i18next'
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
  return <main className="inbox-page inbox-page--message" aria-label={t($ => $.navigation.pages.inbox)}>
    <div className="inbox-message">
      <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{configured ? t($ => $.inbox.loadFailed) : t($ => $.inbox.configure)}</Heading></summary>
      <div className="feature-section-body">
        <div className="inbox-message-content">
          <Text as="p" type="supporting" role="status">{message || t($ => $.inbox.configureHelp)}</Text>
          <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
            {configured && <Button onClick={() => void openPage('inbox')} label={t($ => $.settings.retry)} />}
            <Button variant="primary" onClick={() => void openPage('settings')} label={t($ => $.navigation.openSettings)} />
          </Stack>
        </div>
      </div></details></Section>
    </div>
  </main>
}
