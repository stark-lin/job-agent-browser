import type { ComponentPropsWithRef, ReactNode } from 'react'
import { IconBox } from './Icon'

type FeatureCardProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  label: string
  description: string
  icon: ReactNode
}

export function FeatureCard({ label, description, icon, type = 'button', className = '', ...props }: FeatureCardProps) {
  return <button {...props} type={type} className={`ui-feature-card ${className}`.trim()}>
    <IconBox aria-hidden="true">{icon}</IconBox>
    <span>
      <span className="ui-card-label">{label}</span>
      <span className="ui-card-description">{description}</span>
    </span>
  </button>
}
