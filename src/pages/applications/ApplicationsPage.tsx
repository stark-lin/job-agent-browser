import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function ApplicationsPage() {
  const { t } = useTranslation()
  const { openPage } = useNavigation()
  return <PlaceholderPage title={t($ => $.navigation.pages.applications)} description={t($ => $.features.descriptions.applications)}
    actions={<button type="button" onClick={() => void openPage('home')}>{t($ => $.navigation.goHome)}</button>} />
}
