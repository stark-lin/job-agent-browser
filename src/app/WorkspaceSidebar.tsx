import { useEffect, useRef } from 'react'
import { Icon, SideNav, SideNavItem, SideNavSection, Stack } from '@astryxdesign/core'
import { useTranslation } from 'react-i18next'
import { isBrowserDestination, isInboxDestination, type InternalPage } from '../shared/navigation'
import { useNavigation } from './navigation/navigate'
import { featureGroups, pageIcons } from './navigation/features'
import { useServices } from './providers'

export function WorkspaceSidebar() {
  const { t } = useTranslation(), { active, openPage } = useNavigation()
  const { navigation } = useServices()
  const rail = useRef<HTMLElement>(null)
  const destination = active?.destination
  const current = !destination ? undefined : isInboxDestination(destination) ? 'inbox' : isBrowserDestination(destination) ? 'browser' : destination.kind === 'internal' ? destination.page : undefined

  useEffect(() => {
    if (destination?.kind !== 'web') return
    let frame = 0
    const send = (bounds: Parameters<typeof navigation.api.setSidebarTooltip>[0]) => {
      void navigation.api.setSidebarTooltip(bounds).catch(() => {})
    }
    const mirror = (event: Event) => {
      const tooltip = event.target
      if (!(tooltip instanceof HTMLElement) || tooltip.getAttribute('role') !== 'tooltip' || !tooltip.id) return
      const triggers = rail.current?.querySelectorAll('button[aria-describedby]')
      if (!Array.from(triggers ?? []).some(button => button.getAttribute('aria-describedby')?.split(' ').includes(tooltip.id))) return
      cancelAnimationFrame(frame)
      if (!tooltip.matches(':popover-open')) { send(null); return }
      frame = requestAnimationFrame(() => {
        if (!tooltip.matches(':popover-open')) return
        const { x, y, width, height } = tooltip.getBoundingClientRect()
        send({ label: tooltip.textContent ?? '', x, y, width, height })
      })
    }
    document.addEventListener('toggle', mirror, true)
    return () => {
      document.removeEventListener('toggle', mirror, true)
      cancelAnimationFrame(frame)
      send(null)
    }
  }, [destination?.kind, navigation])

  const item = (page: InternalPage) => {
    const label = t($ => $.navigation.pages[page])
    return <SideNavItem key={page} label={label} icon={<Icon icon={pageIcons[page]} />} isSelected={page === current}
      onClick={() => { if (current !== page) void openPage(page) }} />
  }

  return <SideNav ref={rail} className="workspace-sidebar" aria-label={t($ => $.navigation.workspaceNavigation)}
    collapsible={{ isCollapsed: true, hasButton: false }} footer={<div className="workspace-sidebar-footer">{item('settings')}</div>}>
    <Stack width="100%" gap={3}>
      {item('ai')}
      {featureGroups.map(group => <SideNavSection key={group.section} title={t($ => $.navigation.sections[group.section])}
        isHeaderHidden style={{ paddingBlock: 0 }}>
        <Stack gap={2}>{group.pages.map(item)}</Stack>
      </SideNavSection>)}
    </Stack>
  </SideNav>
}
