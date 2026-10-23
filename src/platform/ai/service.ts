import { randomUUID } from 'node:crypto'
import { DataError, fail, type ErrorCode } from '../../domain/common/errors'
import type { AIError, AIEvent, AISettings } from '../../shared/ai'
import { requestConfig, requestTimeout } from './transport'
import { chatInput } from './validation'
import { streamChat, type ChatRequest, type Fetch } from './compatible'
import { createModelDiscovery } from './models'

interface Dependencies {
  settings(): AISettings
  key(providerId: string): string | null
  audit(requestId: string, error: ErrorCode | null): void
  transport?: Fetch
  timeoutMs?: number
}
interface Request {
  id: string; owner: number; controller: AbortController; cancelled: boolean
  emit: (event: AIEvent) => void; snapshot?: ChatRequest; initialError?: AIError
  done?: Promise<void>; resolve?: () => void; running: boolean; onRunning?: () => void
}
const allowedErrors: readonly string[] = ['FORBIDDEN', 'INVALID_INPUT', 'ENCRYPTION_UNAVAILABLE', 'STORAGE_UNAVAILABLE', 'AI_NOT_CONFIGURED',
  'AI_AUTH_FAILED', 'AI_RATE_LIMITED', 'AI_PROVIDER_FAILED', 'AI_PROTOCOL_ERROR', 'AI_CONNECT_FAILED', 'AI_TIMEOUT', 'AI_CANCELLED', 'AUDIT_UNAVAILABLE']
export function aiError(error: unknown): AIError {
  return error instanceof DataError && allowedErrors.includes(error.code) ? error.code as AIError : 'AI_CONNECT_FAILED'
}

/** Main-owned, in-memory requests. No input/output persistence and no SDK retries. */
export function createAIService(deps: Dependencies) {
  const requests = new Map<string, Request>()
  const models = createModelDiscovery(deps)
  let disposed = false
  function publish(request: Request, event: AIEvent) { try { request.emit(event) } catch { request.controller.abort() } }
  function pump() {
    let active = [...requests.values()].filter(request => request.running).length
    for (const request of requests.values()) {
      if (request.running || active >= 16) continue
      if ([...requests.values()].filter(other => other.running && other.owner === request.owner).length >= 4) continue
      request.running = true; active++
      void execute(request).finally(() => { request.resolve?.(); pump() })
    }
  }
  async function execute(request: Request): Promise<void> {
    let auditAttempted = false
    const audit = (error: ErrorCode | null) => {
      auditAttempted = true
      try { deps.audit(request.id, error) } catch { throw new DataError('AUDIT_UNAVAILABLE') }
    }
    const timeout = requestTimeout(request.controller.signal, deps.timeoutMs ?? request.snapshot?.timeoutMs)
    try {
      if (request.cancelled) fail('AI_CANCELLED')
      if (request.initialError) fail(request.initialError)
      if (!request.snapshot) fail('AI_NOT_CONFIGURED')
      request.onRunning?.()
      await streamChat(request.snapshot, timeout.signal, () => {
        timeout.signal.throwIfAborted()
        audit(null)
        publish(request, { requestId: request.id, type: 'started' })
      }, text => {
        timeout.signal.throwIfAborted()
        publish(request, { requestId: request.id, type: 'delta', text })
      }, deps.transport)
      timeout.signal.throwIfAborted()
      publish(request, { requestId: request.id, type: 'completed' })
    } catch (reason) {
      let error: AIError = request.cancelled ? 'AI_CANCELLED' : timeout.timedOut() ? 'AI_TIMEOUT' : aiError(reason)
      if (!auditAttempted) {
        try { audit(error) } catch { error = 'AUDIT_UNAVAILABLE' }
      }
      publish(request, error === 'AI_CANCELLED' ? { requestId: request.id, type: 'cancelled' } : { requestId: request.id, type: 'failed', error })
    } finally {
      timeout.dispose()
      request.controller.abort()
      requests.delete(request.id)
      request.snapshot = undefined
    }
  }
  function cancelRequest(request: Request) {
    request.cancelled = true; request.controller.abort()
    if (request.running) return
    let error: AIError = 'AI_CANCELLED'
    try { deps.audit(request.id, error) } catch { error = 'AUDIT_UNAVAILABLE' }
    publish(request, error === 'AI_CANCELLED' ? { requestId: request.id, type: 'cancelled' } : { requestId: request.id, type: 'failed', error })
    requests.delete(request.id); request.snapshot = undefined; request.resolve?.()
  }
  return {
    listModels: models.list,
    start(owner: number, input: unknown, emit: (event: AIEvent) => void, options?: { queue: boolean; onRunning: () => void }): { requestId: string } {
      if (disposed) fail('AI_PROVIDER_FAILED')
      const args = chatInput(input)
      if (requests.size >= 80 || (!options?.queue && (requests.size >= 16 || [...requests.values()].filter(r => r.owner === owner).length >= 4))) fail('AI_PROVIDER_FAILED')
      const request: Request = { id: randomUUID(), owner, controller: new AbortController(), cancelled: false, emit, running: false, onRunning: options?.onRunning }
      try {
        request.snapshot = { ...requestConfig(deps.settings(), deps.key, args.choice), messages: args.messages }
      } catch (error) { request.initialError = aiError(error) }
      requests.set(request.id, request)
      request.done = new Promise(resolve => { request.resolve = resolve })
      setImmediate(pump)
      return { requestId: request.id }
    },
    cancel(owner: number, requestId: string): void {
      const request = requests.get(requestId)
      if (!request) return
      if (request.owner !== owner) fail('FORBIDDEN')
      cancelRequest(request)
    },
    disposeOwner(owner: number): void {
      models.disposeOwner(owner)
      for (const request of requests.values()) if (request.owner === owner) cancelRequest(request)
    },
    async dispose(): Promise<void> {
      disposed = true
      for (const request of requests.values()) cancelRequest(request)
      await Promise.all([models.dispose(), ...[...requests.values()].map(request => request.done)])
    }
  }
}
export type AIService = ReturnType<typeof createAIService>
