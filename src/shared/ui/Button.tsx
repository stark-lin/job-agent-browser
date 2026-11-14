import type { ComponentPropsWithRef } from 'react'

type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'icon' | 'tab' | 'tab-close' | 'add-card'
  size?: 'sm' | 'md' | 'lg'
}

export function Button({ variant = 'default', size = 'md', type = 'button', className = '', ...props }: ButtonProps) {
  return <button {...props} type={type} className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()} />
}

export function IconButton({ size = 'sm', ...props }: Omit<ButtonProps, 'variant' | 'size'> & { 'aria-label': string; size?: 'sm' | 'md' }) {
  return <Button {...props} variant="icon" size={size} />
}

export function ActionRow({ className = '', align = 'end', ...props }: ComponentPropsWithRef<'div'> & { align?: 'start' | 'end' }) {
  return <div {...props} className={`ui-action-row ui-action-row--${align} ${className}`.trim()} />
}
