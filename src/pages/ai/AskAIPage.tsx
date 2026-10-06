import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function AskAIPage() {
  const { t } = useTranslation()
  const { openPage } = useNavigation()
  return <PlaceholderPage title={t($ => $.navigation.pages.ai)} description={t($ => $.features.descriptions.ai)}
    actions={<button type="button" onClick={() => void openPage('home')}>{t($ => $.navigation.goHome)}</button>} />
}
