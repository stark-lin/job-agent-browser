import { type ComponentPropsWithoutRef, type ReactNode } from 'react'

export function Sidebar({ label, children, footer }: {
  label: string; children: ReactNode; footer: ReactNode
}) {
  return <aside className="ui-sidebar">
    <nav className="ui-sidebar-navigation" aria-label={label}>
      <div className="ui-sidebar-content">{children}</div>
      <div className="ui-sidebar-footer">{footer}</div>
    </nav>
  </aside>
}

export function NavigationGroup({ label, children }: { label: string; children: ReactNode }) {
  return <section className="ui-navigation-group" aria-label={label}>
    {children}
  </section>
}

export function NavigationItem({ label, icon, active = false, ...props }: Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'className'> & {
  label: string; icon: ReactNode; active?: boolean
}) {
  return <button {...props} type="button" className="ui-navigation-item" aria-label={label} title={label} aria-current={active ? 'page' : undefined}>
    {icon}
  </button>
}
