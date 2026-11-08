import { useRef, useState, type ComponentProps } from 'react'
import { Button } from './Button'

type CopyButtonProps = Omit<ComponentProps<typeof Button>, 'children' | 'onClick' | 'aria-live' | 'aria-busy'> & {
  copyLabel: string
  copiedLabel: string
  /** Allow copying a newer live snapshot without replacing the focused button. */
  resetKey?: string | number
  /** Return false after displaying an error to keep the action retryable. */
  onCopy(): Promise<boolean>
}

/** Keeps success feedback on the initiating button until a new copy scope is selected. */
export function CopyButton({ copyLabel, copiedLabel, resetKey, onCopy, disabled, ...props }: CopyButtonProps) {
  const blocked = useRef(false), [copying, setCopying] = useState(false), [copiedFor, setCopiedFor] = useState<{ key?: string | number } | null>(null)
  const lastCopy = useRef<typeof copiedFor>(null)
  const copied = Boolean(copiedFor && copiedFor.key === resetKey)
  return <Button {...props} disabled={disabled || copying || copied} aria-live="polite" aria-busy={copying} onClick={() => {
    if (disabled || blocked.current || lastCopy.current && lastCopy.current.key === resetKey) return
    blocked.current = true; setCopying(true)
    void (async () => {
      let success = false
      try { success = await onCopy() } catch { /* The caller owns error feedback; rejected copies remain retryable. */ }
      finally {
        blocked.current = false
        if (success) { lastCopy.current = { key: resetKey }; setCopiedFor(lastCopy.current) }
        setCopying(false)
      }
    })()
  }}>{copied ? copiedLabel : copyLabel}</Button>
}
