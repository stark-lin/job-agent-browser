import { PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function TailorResumePage() {
  const { active, back, openPage } = useNavigation()
  return <PlaceholderPage title="Tailor Resume" description="Adapt your resume to a role."
    canGoBack={Boolean(active?.canGoBack)} onBack={() => void back()} onHome={() => void openPage('home')} />
}
