import { useId, useState, type ComponentPropsWithRef, type ReactNode } from 'react'
import { Icon } from './Icon'

interface FieldControl { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }
export function FormField({ label, help, error, children }: {
  label: string; help?: string; error?: string; children: (props: FieldControl) => ReactNode
}) {
  const id = useId(), description = `${id}-help`
  return <div className="ui-field">
    <label className="ui-field-label" htmlFor={id}>{label}</label>
    {children({ id, 'aria-describedby': help || error ? description : undefined, 'aria-invalid': error ? true : undefined })}
    {(help || error) && <span id={description} className={`ui-field-help${error ? ' ui-field-help--error' : ''}`} role={error ? 'alert' : undefined}>{error || help}</span>}
  </div>
}

export function Select({ className = '', ...props }: ComponentPropsWithRef<'select'>) {
  return <select {...props} className={`ui-select ${className}`.trim()} />
}

export function SectionCard({ title, description, defaultCollapsed = false, children, onToggle, onInvalidCapture, ...props }:
  Omit<ComponentPropsWithRef<'details'>, 'title' | 'open' | 'name'> & {
    title: string; description?: string; defaultCollapsed?: boolean; children: ReactNode
  }) {
  const id = useId(), [open, setOpen] = useState(!defaultCollapsed)
  return <details {...props} className="ui-section-card" aria-labelledby={id} open={open}
    onToggle={event => {
      if (event.target === event.currentTarget) setOpen(event.currentTarget.open)
      onToggle?.(event)
    }}
    onInvalidCapture={event => {
      event.currentTarget.open = true
      onInvalidCapture?.(event)
    }}>
    <summary className="ui-section-heading">
      <h2 id={id}>
        <span className="ui-section-title" title={title}>{title}</span>
        <Icon className="ui-section-chevron"><path d="m9 6 6 6-6 6" /></Icon>
      </h2>
    </summary>
    {description && <p className="ui-section-description">{description}</p>}
    <div className="ui-section-body">{children}</div>
  </details>
}

export function revealSectionCards(target: Element) {
  for (let card = target.closest<HTMLDetailsElement>('details.ui-section-card'); card;
    card = card.parentElement?.closest<HTMLDetailsElement>('details.ui-section-card') ?? null) {
    card.open = true
  }
}

export function StatusMessage({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'error' | 'info' }) {
  return <p className={`ui-status ui-status--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>
}
