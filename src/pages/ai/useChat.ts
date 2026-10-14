import { useEffect, useRef, useState } from 'react'
import { useServices } from '../../app/providers'
import { useAIRequest } from '../../app/ai/useAIRequest'
import type { AIChoice, AIError, AIEvent, AIMessage, AISettings } from '../../shared/ai'

export interface ChatTurn extends AIMessage {
  id: string; state: 'completed' | 'streaming' | 'failed' | 'cancelled'; model?: string; provider?: string
}
export function useChat() {
  const { data } = useServices(), client = useAIRequest()
  const [config, setConfig] = useState<AISettings | null>(null), [choice, setChoice] = useState<AIChoice | null>(null)
  const [turns, setTurns] = useState<ChatTurn[]>([]), [text, setText] = useState('')
  const [error, setError] = useState<AIError | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const lock = useRef(false), mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    void data.settings.get({}).then(result => {
      if (!mounted.current) return
      if (result.ok) { setConfig(result.value.ai); setChoice(result.value.ai.default) }
      else setError('STORAGE_UNAVAILABLE')
    }).catch(() => { if (mounted.current) setError('STORAGE_UNAVAILABLE') }).finally(() => { if (mounted.current) setLoading(false) })
    return () => { mounted.current = false }
  }, [data])
  async function send(retry = false) {
    if (lock.current || !choice || !client.current) return
    const lastUser = turns.map(turn => turn.role).lastIndexOf('user')
    const content = retry && lastUser >= 0 ? turns[lastUser].content : text.trim()
    if (!content) return
    const history = retry ? turns.slice(0, lastUser) : turns
    const provider = config?.providers.find(p => p.id === choice.providerId)
    const user: ChatTurn = { id: crypto.randomUUID(), role: 'user', content, state: 'completed' }
    const response: ChatTurn = { id: crypto.randomUUID(), role: 'assistant', content: '', state: 'streaming', provider: provider?.name, model: choice.modelId }
    const messages = [...history.filter(turn => turn.state === 'completed').map(({ role, content }) => ({ role, content })), { role: 'user' as const, content }]
    lock.current = true; setBusy(true); setError(null); setText(''); setTurns([...history, user, response])
    const finish = (state: ChatTurn['state']) => {
      lock.current = false; setBusy(false)
      setTurns(previous => previous.map(turn => turn.id === response.id ? { ...turn, state } : turn))
    }
    const receive = (event: AIEvent) => {
      if (!mounted.current) return
      if (event.type === 'delta') setTurns(previous => previous.map(turn => turn.id === response.id ? { ...turn, content: turn.content + event.text } : turn))
      if (event.type === 'completed') finish('completed')
      if (event.type === 'cancelled') finish('cancelled')
      if (event.type === 'failed') { setError(event.error); finish('failed') }
    }
    const result = await client.current.start({ choice, messages }, receive)
    if (!result.ok && mounted.current) { setError(result.error); finish('failed') }
  }
  return { config, choice, setChoice, turns, text, setText, error, busy, loading, send,
    stop: () => client.current?.cancel(),
    reset: () => { if (!lock.current) { setTurns([]); setText(''); setError(null) } } }
}
