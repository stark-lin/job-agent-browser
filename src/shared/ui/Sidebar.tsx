import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react'

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

export function NavigationItem({ label, icon, active = false, onTooltipChange, ...props }: Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'className' | 'title'> & {
  label: string; icon: ReactNode; active?: boolean; onTooltipChange?: (bounds: DOMRect | null) => void
}) {
  const tooltipId = useId()
  const tooltipTrigger = { interestfor: tooltipId }
  return <>
    <button {...props} {...tooltipTrigger} type="button" className="ui-navigation-item" aria-label={label} aria-current={active ? 'page' : undefined}>
      {icon}
    </button>
    <span id={tooltipId} className="ui-navigation-tooltip" popover="hint" aria-hidden="true"
      onToggle={onTooltipChange && (event => {
        const tooltip = event.currentTarget
        if (tooltip.matches(':popover-open')) onTooltipChange(tooltip.getBoundingClientRect())
        else if (!tooltip.closest('.ui-sidebar')?.querySelector('.ui-navigation-tooltip:popover-open')) onTooltipChange(null)
      })}>{label}</span>
  </>
}
