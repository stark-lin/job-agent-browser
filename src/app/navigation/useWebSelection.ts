import { useEffect, useRef, useState } from 'react'
import { useServices } from '../providers'
import { useNavigation } from './navigate'
import type { SelectionTarget, WebSelection } from '../../shared/browser-selection'

/** Apply once, then ACK from a committed render. Navigation owns the payload lifetime. */
export function useWebSelection(target: SelectionTarget, apply: (selection: WebSelection) => void) {
  const { navigation } = useServices(), { active } = useNavigation()
  const tabId = active?.id, targetId = active?.targetId
  const applyRef = useRef(apply); applyRef.current = apply
  const installed = useRef<string | null>(null)
  const [committed, setCommitted] = useState<string | null>(null), [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<'failed' | 'tooLarge' | null>(null)
  useEffect(() => {
    if (!tabId || !targetId) return
    let disposed = false
    const current = () => {
      const browser = navigation.getSnapshot().browser
      return !disposed && browser.activeTabId === tabId && browser.tabs.some(tab => tab.id === tabId && tab.targetId === targetId)
    }
    void navigation.api.peekSelection({ tabId, targetId }).then(selection => {
      if (!current() || !selection || selection.target !== target) return
      if (installed.current !== selection.id) {
        applyRef.current(selection)
        installed.current = selection.id
      }
      setCommitted(selection.id); setError(null)
    }).catch(reason => { if (current()) setError(reason instanceof Error && reason.message === 'SELECTION_TOO_LARGE' ? 'tooLarge' : 'failed') })
    return () => { disposed = true }
  }, [navigation, tabId, targetId, target, attempt])
  useEffect(() => {
    if (!committed || !tabId || !targetId) return
    let disposed = false
    void navigation.api.ackSelection({ tabId, targetId, id: committed }).then(() => {
      if (!disposed) setError(null)
    }).catch(() => { if (!disposed) setError('failed') })
    return () => { disposed = true }
  }, [navigation, committed, tabId, targetId, attempt])
  return { error, retry: () => setAttempt(value => value + 1) }
}
