import { randomUUID } from 'node:crypto'
import { DataError, fail, type ErrorCode } from '../../domain/common/errors'
import type { AIError, AIEvent, AISettings } from '../../shared/ai'
import { chatInput } from './validation'
import { streamChat, type ChatRequest, type Fetch } from './compatible'

interface Dependencies {
  settings(): AISettings
  key(providerId: string): string | null
  audit(requestId: string, error: ErrorCode | null): void
  transport?: Fetch
  timeoutMs?: number
}
interface Request {
  id: string; owner: number; controller: AbortController; cancelled: boolean; timedOut: boolean
  emit: (event: AIEvent) => void; snapshot?: ChatRequest; initialError?: AIError
  done?: Promise<void>
}
const allowedErrors: readonly string[] = ['FORBIDDEN', 'INVALID_INPUT', 'ENCRYPTION_UNAVAILABLE', 'STORAGE_UNAVAILABLE', 'AI_NOT_CONFIGURED',
  'AI_AUTH_FAILED', 'AI_RATE_LIMITED', 'AI_PROVIDER_FAILED', 'AI_PROTOCOL_ERROR', 'AI_CONNECT_FAILED', 'AI_TIMEOUT', 'AI_CANCELLED', 'AUDIT_UNAVAILABLE']
export function aiError(error: unknown): AIError {
  return error instanceof DataError && allowedErrors.includes(error.code) ? error.code as AIError : 'AI_CONNECT_FAILED'
}

/** Main-owned, in-memory requests. No input/output persistence and no SDK retries. */
export function createAIService(deps: Dependencies) {
  const requests = new Map<string, Request>()
  let disposed = false
  function publish(request: Request, event: AIEvent) { try { request.emit(event) } catch { request.controller.abort() } }
  async function execute(request: Request): Promise<void> {
    let auditAttempted = false
    const audit = (error: ErrorCode | null) => {
      auditAttempted = true
      try { deps.audit(request.id, error) } catch { throw new DataError('AUDIT_UNAVAILABLE') }
    }
    const timer = setTimeout(() => { request.timedOut = true; request.controller.abort() }, deps.timeoutMs ?? 120000)
    try {
      if (request.cancelled) fail('AI_CANCELLED')
      if (request.initialError) fail(request.initialError)
      if (!request.snapshot) fail('AI_NOT_CONFIGURED')
      await streamChat(request.snapshot, request.controller.signal, () => {
        request.controller.signal.throwIfAborted()
        audit(null)
        publish(request, { requestId: request.id, type: 'started' })
      }, text => {
        request.controller.signal.throwIfAborted()
        publish(request, { requestId: request.id, type: 'delta', text })
      }, deps.transport)
      request.controller.signal.throwIfAborted()
      publish(request, { requestId: request.id, type: 'completed' })
    } catch (reason) {
      let error: AIError = request.cancelled ? 'AI_CANCELLED' : request.timedOut ? 'AI_TIMEOUT' : aiError(reason)
      if (!auditAttempted) {
        try { audit(error) } catch { error = 'AUDIT_UNAVAILABLE' }
      }
      publish(request, error === 'AI_CANCELLED' ? { requestId: request.id, type: 'cancelled' } : { requestId: request.id, type: 'failed', error })
    } finally {
      clearTimeout(timer)
      request.controller.abort()
      requests.delete(request.id)
      request.snapshot = undefined
    }
  }
  return {
    start(owner: number, input: unknown, emit: (event: AIEvent) => void): { requestId: string } {
      if (disposed) fail('AI_PROVIDER_FAILED')
      const args = chatInput(input)
      if (requests.size >= 16 || [...requests.values()].filter(r => r.owner === owner).length >= 4) fail('AI_PROVIDER_FAILED')
      const request: Request = { id: randomUUID(), owner, controller: new AbortController(), cancelled: false, timedOut: false, emit }
      try {
        const config = deps.settings(), provider = config.providers.find(p => p.id === args.choice.providerId)
        if (!provider || !provider.models.includes(args.choice.modelId)) fail('AI_NOT_CONFIGURED')
        const key = provider.requiresKey ? deps.key(provider.id) : null
        if (provider.requiresKey && !key) fail('AI_NOT_CONFIGURED')
        request.snapshot = { provider: structuredClone(provider), model: args.choice.modelId, key, messages: args.messages }
      } catch (error) { request.initialError = aiError(error) }
      requests.set(request.id, request)
      request.done = new Promise(resolve => { setImmediate(() => { void execute(request).finally(resolve) }) })
      return { requestId: request.id }
    },
    cancel(owner: number, requestId: string): void {
      const request = requests.get(requestId)
      if (!request) return
      if (request.owner !== owner) fail('FORBIDDEN')
      request.cancelled = true; request.controller.abort()
    },
    disposeOwner(owner: number): void {
      for (const request of requests.values()) if (request.owner === owner) { request.cancelled = true; request.controller.abort() }
    },
    async dispose(): Promise<void> {
      disposed = true
      for (const request of requests.values()) { request.cancelled = true; request.controller.abort() }
      await Promise.all([...requests.values()].map(request => request.done))
    }
  }
}
export type AIService = ReturnType<typeof createAIService>
