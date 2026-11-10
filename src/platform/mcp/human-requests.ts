import { randomUUID } from 'node:crypto'
import type { HumanAskInput, HumanAskResult, HumanRequest } from '../../shared/human'
import { toolFail, ToolError } from '../../shared/tools/errors'

export function parseHumanInput(value: unknown): HumanAskInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) toolFail('TOOL_INVALID_INPUT')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['question', 'options'].includes(key)) || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 8192
    || input.options !== undefined && (!Array.isArray(input.options) || input.options.length > 20 || input.options.some(option => typeof option !== 'string' || !option.trim() || option.length > 1024) || new Set(input.options).size !== input.options.length)) toolFail('TOOL_INVALID_INPUT')
  return structuredClone(input) as unknown as HumanAskInput
}
/** Main owns ephemeral requests. No business locks, persistence, or model reasoning. */
export function createHumanRequests() {
  const requests = new Map<string, { owner: string; request: HumanRequest; finish(result?: HumanAskResult): void }>()
  const listeners = new Set<() => void>()
  let disposed = false
  const notify = () => { for (const listener of listeners) listener() }
  const service = {
    list: () => [...requests.values()].map(entry => structuredClone(entry.request)),
    ask(owner: string, value: unknown, signal: AbortSignal): Promise<HumanAskResult> {
      const input = parseHumanInput(value)
      signal.throwIfAborted()
      if (disposed) toolFail('TOOL_UNAVAILABLE')
      if ([...requests.values()].some(entry => entry.owner === owner)) toolFail('TOOL_BUSY')
      return new Promise((resolve, reject) => {
        const id = randomUUID()
        const abort = () => finish()
        const finish = (result?: HumanAskResult) => {
          if (!requests.delete(id)) return
          signal.removeEventListener('abort', abort)
          notify()
          if (result) resolve(result); else reject(new ToolError('TOOL_CANCELLED'))
        }
        requests.set(id, { owner, request: { id, ...input }, finish })
        signal.addEventListener('abort', abort, { once: true })
        notify()
        if (signal.aborted) abort()
      })
    },
    answer(id: string, value: unknown) {
      const entry = requests.get(id)
      if (!entry) toolFail('TOOL_NOT_FOUND')
      if (!value || typeof value !== 'object' || Array.isArray(value)) toolFail('TOOL_INVALID_INPUT')
      const input = value as Record<string, unknown>
      if (Object.keys(input).some(key => !['selectedOption', 'text'].includes(key)) || typeof input.text !== 'string' || input.text.length > 20000 || input.selectedOption !== null && (typeof input.selectedOption !== 'string' || !entry.request.options?.includes(input.selectedOption)) || !input.text.trim() && input.selectedOption === null) toolFail('TOOL_INVALID_INPUT')
      entry.finish({ status: 'submitted', selectedOption: input.selectedOption as string | null, text: input.text.trim() })
    },
    cancel(id: string) {
      const entry = requests.get(id)
      if (!entry) toolFail('TOOL_NOT_FOUND')
      entry.finish({ status: 'cancelled' })
    },
    cancelOwner(owner: string) { for (const entry of requests.values()) if (entry.owner === owner) entry.finish() },
    invalidate(id: string) { requests.get(id)?.finish() },
    cancelAll() { for (const entry of requests.values()) entry.finish() },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose() { disposed = true; service.cancelAll(); listeners.clear() }
  }
  return service
}
export type HumanRequests = ReturnType<typeof createHumanRequests>
