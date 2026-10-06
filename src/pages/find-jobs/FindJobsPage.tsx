import { PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function FindJobsPage() {
  const { active, back, openPage } = useNavigation()
  return <PlaceholderPage title="Find Jobs" description="Search and browse opportunities." canGoBack={Boolean(active?.canGoBack)}
    onBack={() => void back()} onHome={() => void openPage('home')}></PlaceholderPage>
}
