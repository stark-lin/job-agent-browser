import { PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function ProfilePage() {
  const { active, back, openPage } = useNavigation()
  return <PlaceholderPage title="My Profile" description="Manage your resume, experience and preferences." canGoBack={Boolean(active?.canGoBack)}
    onBack={() => void back()} onHome={() => void openPage('home')}></PlaceholderPage>
}
