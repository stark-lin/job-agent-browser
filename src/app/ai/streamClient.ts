import type { AIAPI, AIEvent, AIInput } from '../../shared/ai'

/** Renderer coordination only: subscribe before invoke so early IPC chunks are never lost. */
export class AIStreamClient {
  private current: { id?: string; cancelled: boolean; unsubscribe: () => void } | null = null
  constructor(private readonly api: AIAPI) {}
  async start(input: AIInput, receive: (event: AIEvent) => void) {
    if (this.current) return { ok: false as const, error: 'INVALID_INPUT' as const }
    const session = { id: undefined as string | undefined, cancelled: false, unsubscribe: () => {} }
    this.current = session
    const early: AIEvent[] = []
    let overflow = false
    const dispatch = (event: AIEvent) => {
      if (this.current !== session || event.requestId !== session.id) return
      if (session.cancelled && (event.type === 'delta' || event.type === 'started')) return
      if (event.type === 'completed' || event.type === 'cancelled' || event.type === 'failed') {
        session.unsubscribe(); this.current = null
      }
      receive(session.cancelled && event.type === 'completed' ? { requestId: event.requestId, type: 'cancelled' } : event)
    }
    session.unsubscribe = this.api.onEvent(event => {
      if (!session.id) { if (early.length < 1024) early.push(event); else overflow = true }
      else dispatch(event)
    })
    try {
      const result = await this.api.start(input)
      if (!result.ok) {
        session.unsubscribe(); if (this.current === session) this.current = null
        return result
      }
      session.id = result.value.requestId
      if (overflow) {
        session.unsubscribe(); if (this.current === session) this.current = null
        void this.api.cancel({ requestId: session.id }).catch(() => {})
        return { ok: false as const, error: 'AI_PROTOCOL_ERROR' as const }
      }
      if (this.current !== session || session.cancelled) {
        void this.api.cancel({ requestId: session.id }).catch(() => {})
      }
      for (const event of early) dispatch(event)
      return result
    } catch {
      session.unsubscribe(); if (this.current === session) this.current = null
      return { ok: false as const, error: 'AI_CONNECT_FAILED' as const }
    }
  }
  cancel(): void {
    if (!this.current) return
    this.current.cancelled = true
    if (this.current.id) void this.api.cancel({ requestId: this.current.id }).catch(() => {})
  }
  dispose(): void {
    this.cancel(); this.current?.unsubscribe(); this.current = null
  }
}
