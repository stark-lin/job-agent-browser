import { PlaceholderPage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'

export function InboxPage() {
  const { active, back, openPage } = useNavigation()
  return <PlaceholderPage title="Inbox" description="Job-seeking email will open your configured webmail." canGoBack={Boolean(active?.canGoBack)}
    onBack={() => void back()} onHome={() => void openPage('home')}>
      <button type="button" onClick={() => void openPage('settings')}>Open Settings</button>
    </PlaceholderPage>
}
