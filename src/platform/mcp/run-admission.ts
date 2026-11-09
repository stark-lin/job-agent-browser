import { randomUUID } from 'node:crypto'
import { toolFail } from '../../shared/tools/errors'

export interface ExecutionRun { id: string; owner: string; createdAt: number; signal: AbortSignal; state: 'ACTIVE' | 'CLOSED' }
/** Main-owned, volatile admission. No database connection or business mutation belongs here. */
export function createRunAdmission() {
  let active: (ExecutionRun & { controller: AbortController }) | undefined
  let external: string | undefined
  return {
    acquire(owner: string): ExecutionRun {
      if (active) toolFail('TOOL_BUSY')
      const controller = new AbortController()
      active = { id: randomUUID(), owner, createdAt: Date.now(), signal: controller.signal, state: 'ACTIVE', controller }
      return active
    },
    release(owner: string, id: string) {
      if (!active) return
      if (active.owner !== owner || active.id !== id) toolFail('TOOL_FORBIDDEN')
      active.state = 'CLOSED'; active.controller.abort(); active = undefined
    },
    openExternal(owner: string) { if (external) toolFail('TOOL_BUSY'); external = owner },
    closeExternal(owner: string) { if (external === owner) external = undefined },
    current: () => active as ExecutionRun | undefined
  }
}
export type RunAdmission = ReturnType<typeof createRunAdmission>
