import { useEffect, useState, type FormEvent } from 'react'

interface AddressBarProps {
  url: string
  isLoading: boolean
  error: string
  onNavigate: (input: string) => Promise<void>
}

export function AddressBar({ url, isLoading, error, onNavigate }: AddressBarProps) {
  const [value, setValue] = useState(url)
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    if (!isEditing) setValue(url)
  }, [url, isEditing])

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setIsEditing(false)
    void onNavigate(value)
  }

  return (
    <form className="address-form" onSubmit={submit}>
      <span className={`loading-indicator${isLoading ? ' is-loading' : ''}${error ? ' has-error' : ''}`} aria-hidden="true" title={error || undefined} />
      <input
        aria-label="Search or enter URL"
        aria-invalid={Boolean(error)}
        title={error || undefined}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="Search or enter URL..."
        value={value}
        onFocus={() => setIsEditing(true)}
        onBlur={() => setIsEditing(false)}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  )
}
