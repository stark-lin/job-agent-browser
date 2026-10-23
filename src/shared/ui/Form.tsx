import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'

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

export function SectionCard({ title, description, children, ...props }: Omit<ComponentPropsWithRef<'section'>, 'title'> & { title: string; description?: string; children: ReactNode }) {
  const id = useId()
  return <section {...props} className="ui-section-card" aria-labelledby={id}>
    <div className="ui-section-heading"><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div>
    {children}
  </section>
}

export function PageHeading({ title, description }: { title: string; description?: string }) {
  return <header className="ui-page-heading"><h1>{title}</h1>{description && <p>{description}</p>}</header>
}

export function StatusMessage({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'error' | 'info' }) {
  return <p className={`ui-status ui-status--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>
}
