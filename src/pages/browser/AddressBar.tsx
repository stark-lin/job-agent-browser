import { TextInput } from '@astryxdesign/core'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useServices } from '../../app/providers'

interface AddressBarProps {
  url: string
  isLoading: boolean
  error: string
  onNavigate: (input: string) => Promise<void>
}

export function AddressBar({ url, isLoading, error, onNavigate }: AddressBarProps) {
  const { t } = useTranslation()
  const { navigation } = useServices()
  const [value, setValue] = useState(url)
  const [isEditing, setIsEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => navigation.api.onFocusAddress(() => {
    input.current?.focus()
    input.current?.select()
  }), [navigation])

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
      <TextInput
        ref={input}
        hasAutoFocus
        size="sm"
        width="100%"
        containerClassName="address-input"
        isLabelHidden
        label={t($ => $.browser.addressLabel)}
        aria-invalid={Boolean(error)}
        autoComplete="off"
        autoCapitalize="off"
        hasSpellCheck={false}
        placeholder={t($ => $.browser.addressPlaceholder)}
        value={value}
        onFocus={() => { setIsEditing(true); input.current?.select() }}
        onBlur={() => setIsEditing(false)}
        onChange={event => { setIsEditing(true); setValue(event) }}
      />
    </form>
  )
}
