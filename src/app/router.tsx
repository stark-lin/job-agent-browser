import { Layout, LayoutPanel, Text } from '@astryxdesign/core'
import { KnowledgePage } from '../pages/knowledge'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { useNavigation } from './navigation/navigate'
import { BrowserPage } from '../pages/browser'
import { AddJobPage } from '../pages/find-jobs'
import { TailorResumePage } from '../pages/tailor-resume'
import { ApplicationsPage } from '../pages/applications'
import { InboxPage } from '../pages/inbox'
import { ProfilePage } from '../pages/profile'
import { AskAIPage } from '../pages/ai'
import { SettingsPage } from '../pages/settings'
import { isBrowserDestination, isInboxDestination } from '../shared/navigation'
import { WorkspaceSidebar } from './WorkspaceSidebar'

const featurePages = {
  find: AddJobPage, resume: TailorResumePage, knowledge: KnowledgePage,
  applications: ApplicationsPage, inbox: InboxPage, profile: ProfilePage,
  ai: AskAIPage, settings: SettingsPage
}

export function AppRouter() {
  const { t } = useTranslation()
  const { active, error } = useNavigation()
  if (!active) return <main className="feature-page" role={error ? 'alert' : 'status'}>{error || t($ => $.app.loadingWorkspace)}</main>
  const destination = active.destination
  let page: ReactNode
  if (isInboxDestination(destination)) page = <InboxPage />
  else if (isBrowserDestination(destination)) page = <BrowserPage />
  else if (destination.kind === 'internal' && destination.page !== 'browser') {
    const Page = featurePages[destination.page]
    page = <Page key={active.targetId} />
  }
  return <Layout className="app-shell" height="fill" padding={0} start={<LayoutPanel width="var(--sidebar-width)" padding={0}><WorkspaceSidebar /></LayoutPanel>} content={<div className="app-content">
    {page}{error && !isBrowserDestination(destination) && !isInboxDestination(destination) ? <Text as="div" className="app-error" role="alert">{error}</Text> : null}
  </div>} />
}
