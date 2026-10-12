import { useTranslation } from 'react-i18next'
import { Button, PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function TailorResumePage() {
  const { t } = useTranslation()
  const { openPage } = useNavigation()
  return <PlaceholderPage title={t($ => $.navigation.pages.resume)} description={t($ => $.features.descriptions.resume)}
    actions={<Button type="button" onClick={() => void openPage('home')}>{t($ => $.navigation.goHome)}</Button>} />
}
