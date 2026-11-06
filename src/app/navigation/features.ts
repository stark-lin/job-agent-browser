import type { GlyphName } from '../../shared/ui'
import type { InternalPage } from '../../shared/navigation'

export const featureGroups = [
  { section: 'manage', pages: ['profile', 'resume', 'knowledge'] },
  { section: 'search', pages: ['find', 'applications', 'inbox'] },
  { section: 'tools', pages: ['browser'] }
] as const
export const pageIcons = {
  find: 'plus', resume: 'document', knowledge: 'notebook', applications: 'list',
  inbox: 'mail', profile: 'person', browser: 'globe', ai: 'sparkles', settings: 'settings'
} as const satisfies Record<InternalPage, GlyphName>
