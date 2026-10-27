import type { ComponentPropsWithRef } from 'react'
export function Progress({ className = '', ...props }: ComponentPropsWithRef<'progress'>) {
  return <progress {...props} className={`ui-progress ${className}`.trim()} />
}
