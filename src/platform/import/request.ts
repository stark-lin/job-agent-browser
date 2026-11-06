import { DataError } from '../../domain/common/errors'
import type { AIChoice, AIError } from '../../shared/ai'
import type { AIService } from '../ai'

export class ImportRequestFailure extends Error {
  constructor(readonly code: AIError) { super(code) }
}
export function importErrorCode(error: unknown): string {
  return error instanceof DataError || error instanceof ImportRequestFailure ? error.code
    : error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'AI_PROVIDER_FAILED'
}
export function requestImport(ai: Pick<AIService, 'start' | 'cancel'>, owner: number, choice: AIChoice, prompt: string, signal: AbortSignal): Promise<string> {
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
        if (event.type === 'delta') {
          output += event.text
          if (output.length > 1000000) { finish(new ImportRequestFailure('AI_PROTOCOL_ERROR')); if (id) ai.cancel(owner, id) }
        } else if (event.type === 'completed') finish()
        else if (event.type === 'failed') finish(new ImportRequestFailure(event.error))
        else if (event.type === 'cancelled') finish(new ImportRequestFailure('AI_CANCELLED'))
      }, { queue: true, onRunning: () => {} }).requestId
      if (signal.aborted) abort()
    } catch (error) { finish(error) }
  })
}
