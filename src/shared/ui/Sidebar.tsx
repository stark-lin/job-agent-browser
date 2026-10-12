import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react'

export function Sidebar({ brand, icon, label, children, footer }: {
  brand: string; icon: ReactNode; label: string; children: ReactNode; footer: ReactNode
}) {
  return <aside className="ui-sidebar">
    <div className="ui-sidebar-brand"><span className="ui-sidebar-brand-icon">{icon}</span><span className="ui-sidebar-brand-label">{brand}</span></div>
    <nav className="ui-sidebar-navigation" aria-label={label}>
      <div className="ui-sidebar-content">{children}</div>
      <div className="ui-sidebar-footer">{footer}</div>
    </nav>
  </aside>
}

export function NavigationGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  return <section className="ui-navigation-group" aria-labelledby={id}>
    <h2 id={id} className="ui-navigation-group-title">{label}</h2>{children}
  </section>
}

export function NavigationItem({ label, icon, active = false, ...props }: Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'className'> & {
  label: string; icon: ReactNode; active?: boolean
}) {
  return <button {...props} type="button" className="ui-navigation-item" aria-label={label} title={label} aria-current={active ? 'page' : undefined}>
    {icon}<span className="ui-navigation-label">{label}</span>
  </button>
}
