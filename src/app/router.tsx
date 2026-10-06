import type { ReactNode } from 'react'
import { useNavigation } from './navigation/navigate'
import { HomePage } from '../pages/home/HomePage'
import { BrowserPage } from '../pages/browser'
import { FindJobsPage } from '../pages/find-jobs'
import { TailorResumePage } from '../pages/tailor-resume'
import { InterviewPrepPage } from '../pages/interview-prep'
import { ApplicationsPage } from '../pages/applications'
import { InboxPage } from '../pages/inbox'
import { ProfilePage } from '../pages/profile'
import { AskAIPage } from '../pages/ai'
import { SettingsPage } from '../pages/settings'
import { isBrowserDestination } from '../shared/navigation'

const featurePages = {
  find: FindJobsPage, resume: TailorResumePage, interview: InterviewPrepPage,
  applications: ApplicationsPage, inbox: InboxPage, profile: ProfilePage,
  ai: AskAIPage, settings: SettingsPage
}

export function AppRouter() {
  const { active, error, back, openPage } = useNavigation()
  if (!active) return <main className="feature-page" role={error ? 'alert' : 'status'}>{error || 'Loading workspace…'}</main>
  const destination = active.destination
  let page: ReactNode
  if (isBrowserDestination(destination)) page = <BrowserPage />
  else if (destination.kind === 'internal' && destination.page === 'home') {
    page = <HomePage onNavigate={(target) => void openPage(target)} canGoBack={active.canGoBack} onBack={() => void back()} />
  } else if (destination.kind === 'internal' && destination.page !== 'browser' && destination.page !== 'home') {
    const Page = featurePages[destination.page]
    page = <Page />
  }
  return <>{page}{error && !isBrowserDestination(destination) ? <div className="app-error" role="alert">{error}</div> : null}</>
}
