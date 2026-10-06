import { PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function InterviewPrepPage() {
  const { active, back, openPage } = useNavigation()
  return <PlaceholderPage title="Interview Prep" description="Prepare for a specific role." canGoBack={Boolean(active?.canGoBack)}
    onBack={() => void back()} onHome={() => void openPage('home')}></PlaceholderPage>
}
