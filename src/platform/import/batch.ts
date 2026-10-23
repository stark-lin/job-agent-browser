import { DataError } from '../../domain/common/errors'
import type { AIChoice, AIError } from '../../shared/ai'
import type { ImportGroup, ImportGroupProgress } from '../../shared/import'
import type { AIService } from '../ai'

export interface ImportPart<T> { id: ImportGroup; prompt: string; parse: (text: string) => T }
export class ImportRequestFailure extends Error {
  constructor(readonly code: AIError) { super(code) }
}
export function importErrorCode(error: unknown): string {
  return error instanceof DataError || error instanceof ImportRequestFailure ? error.code
    : error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'AI_PROVIDER_FAILED'
}
/** Results and timing stay in task memory. Only failed parts are submitted again. */
export function createImportBatch<T>(ai: Pick<AIService, 'start' | 'cancel'>, owner: number, choice: AIChoice, parts: ImportPart<T>[]) {
  const values = new Map<ImportGroup, T>()
  const states = parts.map(part => ({ id: part.id, state: 'queued', queueMs: 0, elapsedMs: 0 }) as ImportGroupProgress)
  const errors = new Map<ImportGroup, unknown>()
  let running = false
  return {
    get retryable() { return !running && states.some(state => state.state === 'failed') },
    async run(signal: AbortSignal, progress: (groups: ImportGroupProgress[]) => void): Promise<T[]> {
      if (running) throw new ImportRequestFailure('AI_PROVIDER_FAILED')
      running = true
      const pending = parts.filter(part => !values.has(part.id))
      for (const part of pending) Object.assign(states.find(state => state.id === part.id)!, { state: 'queued', queueMs: 0, elapsedMs: 0, error: undefined })
      const queuedAt = performance.now()
      const startedAt = new Map<ImportGroup, number>()
      const publish = () => {
        if (signal.aborted) return
        const now = performance.now()
        for (const state of states) {
          if (state.state === 'queued') state.queueMs = now - queuedAt
          else if (state.state === 'running') state.elapsedMs = now - startedAt.get(state.id)!
        }
        progress(states.map(state => ({ ...state })))
      }
      const timer = setInterval(publish, 100)
      const stopTiming = () => clearInterval(timer)
      signal.addEventListener('abort', stopTiming, { once: true })
      try {
        publish()
        let index = 0
        async function worker() {
          while (index < pending.length && !signal.aborted) {
            const part = pending[index++], state = states.find(state => state.id === part.id)!
            let began: number | undefined
            const begin = () => {
              if (began !== undefined || signal.aborted) return
              began = performance.now(); startedAt.set(part.id, began)
              state.queueMs = began - queuedAt; state.state = 'running'; publish()
            }
            try {
              const text = await collect(ai, owner, choice, part.prompt, signal, begin)
              signal.throwIfAborted()
              values.set(part.id, part.parse(text)); state.state = 'completed'
            } catch (error) {
              errors.set(part.id, error)
              state.state = signal.aborted ? 'cancelled' : 'failed'; state.error = importErrorCode(error)
            } finally {
              const now = performance.now()
              state.queueMs = (began ?? now) - queuedAt; state.elapsedMs = began === undefined ? 0 : now - began; publish()
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker))
        signal.throwIfAborted()
        const failed = states.find(state => state.state === 'failed')
        if (failed) throw errors.get(failed.id)
        return parts.map(part => values.get(part.id)!)
      } finally {
        stopTiming(); signal.removeEventListener('abort', stopTiming)
        running = false
      }
    }
  }
}
function collect(ai: Pick<AIService, 'start' | 'cancel'>, owner: number, choice: AIChoice, prompt: string, signal: AbortSignal, onRunning: () => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let id = '', output = '', settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(output)
      output = ''
    }
    const abort = () => { if (id) ai.cancel(owner, id); finish(new ImportRequestFailure('AI_CANCELLED')) }
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    try {
      id = ai.start(owner, { choice, messages: [{ role: 'user', content: prompt }] }, event => {
        if (settled) return
        if (event.type === 'started' || event.type === 'delta') onRunning()
        if (event.type === 'delta') {
          output += event.text
          if (output.length > 1000000) { finish(new ImportRequestFailure('AI_PROTOCOL_ERROR')); if (id) ai.cancel(owner, id) }
        } else if (event.type === 'completed') finish()
        else if (event.type === 'failed') finish(new ImportRequestFailure(event.error))
        else if (event.type === 'cancelled') finish(new ImportRequestFailure('AI_CANCELLED'))
      }, { queue: true, onRunning }).requestId
      if (signal.aborted) abort()
    } catch (error) { finish(error) }
  })
}
