import { FileText, Globe, List, Mail, Notebook, Plus, Settings, Sparkles, UserRound } from 'lucide-react'

export const featureGroups = [
  { section: 'manage', pages: ['profile', 'resume', 'knowledge'] },
  { section: 'search', pages: ['find', 'applications', 'inbox'] },
  { section: 'tools', pages: ['browser'] }
] as const
export const pageIcons = {
  find: Plus, resume: FileText, knowledge: Notebook, applications: List,
  inbox: Mail, profile: UserRound, browser: Globe, ai: Sparkles, settings: Settings
}
