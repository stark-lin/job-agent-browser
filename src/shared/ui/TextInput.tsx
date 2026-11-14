import type { ComponentPropsWithRef } from 'react'

type TextInputProps = ComponentPropsWithRef<'input'> & { variant?: 'default' | 'bare' }

export function TextInput({ variant = 'default', className = '', ...props }: TextInputProps) {
  return <input {...props} className={`ui-input ui-input--${variant} ${className}`.trim()} />
}
