import { useRef, useState } from 'react'

export function useCopyFeedback(scope?: string | number) {
  const pending = useRef(false)
  const lastCopy = useRef<{ scope?: string | number } | null>(null)
  const [copying, setCopying] = useState(false)
  const [success, setSuccess] = useState<typeof lastCopy.current>(null)
  const copied = success !== null && success.scope === scope

  async function copy(write: () => Promise<boolean>) {
    if (pending.current || (lastCopy.current && lastCopy.current.scope === scope)) return
    pending.current = true
    setCopying(true)
    try {
      if (await write()) {
        lastCopy.current = { scope }
        setSuccess(lastCopy.current)
      }
    } catch {
      // The caller owns error feedback. A rejected write remains retryable.
    } finally {
      pending.current = false
      setCopying(false)
    }
  }

  return { copy, copying, copied }
}
