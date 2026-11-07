import { useTranslation } from 'react-i18next'
import { Glyph, NavigationGroup, NavigationItem, Sidebar } from '../shared/ui'
import { isBrowserDestination, isInboxDestination, type InternalPage } from '../shared/navigation'
import { useNavigation } from './navigation/navigate'
import { featureGroups, pageIcons } from './navigation/features'
import { useServices } from './providers'

export function WorkspaceSidebar() {
  const { t } = useTranslation(), { active, openPage } = useNavigation()
  const { navigation } = useServices()
  const destination = active?.destination
  const current = !destination ? undefined : isInboxDestination(destination) ? 'inbox' : isBrowserDestination(destination) ? 'browser' : destination.kind === 'internal' ? destination.page : undefined
  const item = (page: InternalPage) => {
    const label = t($ => $.navigation.pages[page])
    return <NavigationItem key={page} label={label} active={page === current} icon={<Glyph name={pageIcons[page]} />}
      onTooltipChange={destination?.kind === 'web' ? bounds => {
        const tooltip = bounds && { label, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        void navigation.api.setSidebarTooltip(tooltip).catch(() => {})
      } : undefined}
      onClick={() => { if (current !== page) void openPage(page) }} />
  }
  return <Sidebar label={t($ => $.navigation.workspaceNavigation)} footer={item('settings')}>
    {item('ai')}
    {featureGroups.map(group => <NavigationGroup key={group.section} label={t($ => $.navigation.sections[group.section])}>
      {group.pages.map(item)}
    </NavigationGroup>)}
  </Sidebar>
}
