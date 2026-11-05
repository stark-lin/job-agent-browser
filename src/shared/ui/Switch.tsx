interface SwitchProps {
  label: string
  checked: boolean
  disabled?: boolean
  onChange(checked: boolean): void
}

export function Switch({ label, checked, disabled, onChange }: SwitchProps) {
  return <button type="button" className="ui-switch" role="switch" aria-label={label}
    aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
    <span aria-hidden="true" />
  </button>
}
