import { useRef, useState, type ComponentProps } from 'react'
import { Button } from './Button'

type CopyButtonProps = Omit<ComponentProps<typeof Button>, 'children' | 'onClick' | 'aria-live' | 'aria-busy'> & {
  copyLabel: string
  copiedLabel: string
  /** Return false after displaying an error to keep the action retryable. */
  onCopy(): Promise<boolean>
}

/** Keeps success feedback on the initiating button; remount for a newly confirmed copy. */
export function CopyButton({ copyLabel, copiedLabel, onCopy, disabled, ...props }: CopyButtonProps) {
  const blocked = useRef(false), [copying, setCopying] = useState(false), [copied, setCopied] = useState(false)
  return <Button {...props} disabled={disabled || copying || copied} aria-live="polite" aria-busy={copying} onClick={() => {
    if (disabled || blocked.current) return
    blocked.current = true; setCopying(true)
    void (async () => {
      let success = false
      try { success = await onCopy() } catch { /* The caller owns error feedback; rejected copies remain retryable. */ }
      finally { blocked.current = success; setCopied(success); setCopying(false) }
    })()
  }}>{copied ? copiedLabel : copyLabel}</Button>
}
