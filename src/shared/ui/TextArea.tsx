import type { ComponentPropsWithRef } from 'react'

export function TextArea({ className = '', ...props }: ComponentPropsWithRef<'textarea'>) {
  return <textarea {...props} className={`ui-textarea ${className}`.trim()} />
}
