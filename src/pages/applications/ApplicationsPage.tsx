import { PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function ApplicationsPage() {
  const { active, back, openPage } = useNavigation()
  return <PlaceholderPage title="Applications" description="Track applications in list or calendar view." canGoBack={Boolean(active?.canGoBack)}
    onBack={() => void back()} onHome={() => void openPage('home')}></PlaceholderPage>
}
