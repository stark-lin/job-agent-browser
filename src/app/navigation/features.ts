import type { GlyphName } from '../../shared/ui'
import type { InternalPage } from '../../shared/navigation'

export const featureGroups = [
  { section: 'search', pages: ['find', 'resume', 'knowledge'] },
  { section: 'manage', pages: ['applications', 'inbox', 'profile'] },
  { section: 'tools', pages: ['browser', 'ai', 'settings'] }
] as const
export const features = featureGroups.flatMap(group => [...group.pages])
export const pageIcons = {
  home: 'home', find: 'plus', resume: 'document', knowledge: 'document', applications: 'list',
  inbox: 'mail', profile: 'person', browser: 'globe', ai: 'sparkles', settings: 'settings'
} as const satisfies Record<InternalPage, GlyphName>
