import { useTranslation } from 'react-i18next'
import { Glyph, IconBox, NavigationGroup, NavigationItem, Sidebar } from '../shared/ui'
import { isBrowserDestination, isInboxDestination, type InternalPage } from '../shared/navigation'
import { useNavigation } from './navigation/navigate'
import { featureGroups, pageIcons } from './navigation/features'

export function WorkspaceSidebar() {
  const { t } = useTranslation(), { active, openPage } = useNavigation()
  const destination = active?.destination
  const current = !destination ? undefined : isInboxDestination(destination) ? 'inbox' : isBrowserDestination(destination) ? 'browser' : destination.kind === 'internal' ? destination.page : undefined
  const item = (page: InternalPage) => <NavigationItem key={page} label={t($ => $.navigation.pages[page])} active={page === current}
    icon={<Glyph name={pageIcons[page]} />} onClick={() => { if (current !== page) void openPage(page) }} />
  return <Sidebar brand={t($ => $.home.brand)} label={t($ => $.navigation.workspaceNavigation)}
    icon={<IconBox><Glyph name="globe" /></IconBox>} footer={item('settings')}>
    {item('home')}
    {featureGroups.map(group => <NavigationGroup key={group.section} label={t($ => $.navigation.sections[group.section])}>
      {group.pages.filter(page => page !== 'settings').map(item)}
    </NavigationGroup>)}
  </Sidebar>
}
