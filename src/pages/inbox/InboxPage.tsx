import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function InboxPage() {
  const { t } = useTranslation()
  const { openPage } = useNavigation()
  return <PlaceholderPage title={t($ => $.navigation.pages.inbox)} description={t($ => $.features.descriptions.inbox)}
    actions={<button type="button" onClick={() => void openPage('home')}>{t($ => $.navigation.goHome)}</button>}>
      <button type="button" onClick={() => void openPage('settings')}>{t($ => $.navigation.openSettings)}</button>
    </PlaceholderPage>
}
