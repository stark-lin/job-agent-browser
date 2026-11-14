import { useEffect, useRef, useState } from 'react'

export function useDelimitedValues(value: readonly string[], onChange: (values: string[]) => void) {
  const encoded = JSON.stringify(value)
  const emitted = useRef(encoded)
  const [text, setText] = useState(() => value.join(', '))
  useEffect(() => {
    if (encoded === emitted.current) return
    emitted.current = encoded
    setText(value.join(', '))
  }, [encoded, value])

  return {
    value: text,
    onChange(text: string) {
      const values = text.split(/[,，]/).map(value => value.trim()).filter(Boolean)
      emitted.current = JSON.stringify(values)
      setText(text)
      onChange(values)
    }
  }
}
