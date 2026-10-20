import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react'

export function Checkbox({ label, className = '', id, ...props }: Omit<ComponentPropsWithoutRef<'input'>, 'type'> & { label: ReactNode }) {
  const generated = useId()
  return <label className={`ui-checkbox ${className}`.trim()} htmlFor={id ?? generated}>
    <input {...props} id={id ?? generated} type="checkbox" /><span>{label}</span>
  </label>
}
