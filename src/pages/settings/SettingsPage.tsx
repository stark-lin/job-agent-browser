import { PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function SettingsPage() {
  const { active, back, openPage } = useNavigation()
  return <PlaceholderPage title="Settings" description="Configure AI, browser and application preferences." canGoBack={Boolean(active?.canGoBack)}
    onBack={() => void back()} onHome={() => void openPage('home')}></PlaceholderPage>
}
