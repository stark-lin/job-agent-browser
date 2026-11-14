import type { ComponentPropsWithoutRef } from 'react'

export function Icon({ className = '', ...props }: ComponentPropsWithoutRef<'svg'>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" {...props} className={`ui-icon ${className}`.trim()} />
}

export function IconBox({ className = '', size = 'sm', tone = 'neutral', ...props }: ComponentPropsWithoutRef<'span'> & {
  size?: 'sm' | 'md'
  tone?: 'neutral' | 'primary'
}) {
  return <span {...props} className={`ui-icon-box ui-icon-box--${size} ui-icon-box--${tone} ${className}`.trim()} />
}
