import { useTranslation } from 'react-i18next'
import { Button, PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function InboxPage() {
  const { t } = useTranslation()
  const { openPage } = useNavigation()
  return <PlaceholderPage title={t($ => $.navigation.pages.inbox)} description={t($ => $.features.descriptions.inbox)}
    actions={<Button type="button" onClick={() => void openPage('home')}>{t($ => $.navigation.goHome)}</Button>}>
      <Button type="button" onClick={() => void openPage('settings')}>{t($ => $.navigation.openSettings)}</Button>
    </PlaceholderPage>
}
