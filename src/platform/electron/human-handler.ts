import type { HumanRequests } from '../mcp/human-requests'
import { toolError } from '../../shared/tools/errors'

/** Trusted Main-only IPC dispatch; a renderer can answer only requests it has claimed. */
export function createHumanHandler(service: HumanRequests) {
  const owners = new Map<string, number>()
  const cleanup = service.subscribe(() => { const ids = new Set(service.list().map(request => request.id)); for (const id of owners.keys()) if (!ids.has(id)) owners.delete(id) })
  return {
    dispose: cleanup,
    disposeOwner(owner: number) { for (const [id, claimed] of owners) if (claimed === owner) service.invalidate(id) },
    call(owner: number, trusted: boolean, method: unknown, value: unknown) {
      if (!trusted) return { ok: false as const, error: 'FORBIDDEN' }
      try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false as const, error: 'INVALID_INPUT' }
        const input = value as Record<string, unknown>
        if (method === 'list' && !Object.keys(input).length) {
          const pending = service.list().filter(request => !owners.has(request.id) || owners.get(request.id) === owner)
          for (const request of pending) owners.set(request.id, owner)
          return { ok: true as const, value: pending }
        }
        if (typeof input.id !== 'string' || owners.get(input.id) !== owner) return { ok: false as const, error: 'FORBIDDEN' }
        if (method === 'answer' && Object.keys(input).sort().join(',') === 'id,selectedOption,text') service.answer(input.id, { selectedOption: input.selectedOption, text: input.text })
        else if (method === 'cancel' && Object.keys(input).join(',') === 'id') service.cancel(input.id)
        else return { ok: false as const, error: 'INVALID_INPUT' }
        return { ok: true as const, value: null }
      } catch (error) { return { ok: false as const, error: toolError(error).code } }
    }
  }
}
