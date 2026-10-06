import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function InterviewPrepPage() {
  const { t } = useTranslation()
  const { openPage } = useNavigation()
  return <PlaceholderPage title={t($ => $.navigation.pages.interview)} description={t($ => $.features.descriptions.interview)}
    actions={<button type="button" onClick={() => void openPage('home')}>{t($ => $.navigation.goHome)}</button>} />
}
