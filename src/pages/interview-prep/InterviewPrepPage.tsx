import { useTranslation } from 'react-i18next'
import { Button, PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function InterviewPrepPage() {
  const { t } = useTranslation()
  const { openPage } = useNavigation()
  return <PlaceholderPage title={t($ => $.navigation.pages.interview)} description={t($ => $.features.descriptions.interview)}
    actions={<Button type="button" onClick={() => void openPage('home')}>{t($ => $.navigation.goHome)}</Button>} />
}
