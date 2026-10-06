import { PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function AskAIPage() {
  const { active, back, openPage } = useNavigation()
  return <PlaceholderPage title="Ask AI" description="Work with your job-search context." canGoBack={Boolean(active?.canGoBack)}
    onBack={() => void back()} onHome={() => void openPage('home')}></PlaceholderPage>
}
