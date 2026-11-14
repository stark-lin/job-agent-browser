import { useEffect, useRef, useState, type ComponentPropsWithRef } from 'react'
import { TextInput } from './TextInput'

/** Retain delimiters while typing instead of normalizing away the next list entry. */
export function ListInput({ value, onChange, ...props }: Omit<ComponentPropsWithRef<typeof TextInput>, 'value' | 'onChange'> & {
  value: readonly string[]; onChange: (value: string[]) => void
}) {
  const encoded = JSON.stringify(value), emitted = useRef(encoded)
  const [text, setText] = useState(() => value.join(', '))
  useEffect(() => {
    if (encoded !== emitted.current) { emitted.current = encoded; setText(value.join(', ')) }
  }, [encoded, value])
  return <TextInput {...props} value={text} onChange={event => {
    const text = event.target.value, next = text.split(/[,，]/).map(value => value.trim()).filter(Boolean)
    setText(text); emitted.current = JSON.stringify(next); onChange(next)
  }} />
}
