import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Button } from './Button'
import { Icon } from './Icon'

export function WizardCard({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return <section className="ui-wizard-card" aria-label={title}><header><h1>{title}</h1></header>
    <div className="ui-wizard-body">{children}</div><footer>{footer}</footer></section>
}
export function QuietPanel({ className = '', variant = 'default', ...props }: ComponentPropsWithoutRef<'div'> & { variant?: 'default' | 'dashed' }) {
  return <div {...props} className={`ui-quiet-panel ui-quiet-panel--${variant} ${className}`.trim()} />
}
export function ChoiceCard({ title, description, selected, ...props }: Omit<ComponentPropsWithoutRef<'button'>, 'title'> & {
  title: string; description: string; selected: boolean
}) {
  return <Button {...props} className="ui-choice-card" aria-pressed={selected}>
    <span className="ui-choice-copy"><strong>{title}</strong><small>{description}</small></span>
    <span className="ui-choice-check" aria-hidden="true">{selected && <Icon><path d="m5 12 4 4 10-10" /></Icon>}</span>
  </Button>
}
export function Radio({ label, ...props }: Omit<ComponentPropsWithoutRef<'input'>, 'type'> & { label: string }) {
  return <label className="ui-checkbox"><input {...props} type="radio" /><span>{label}</span></label>
}
