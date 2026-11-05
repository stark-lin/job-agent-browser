import { AgentError } from '../../../shared/agent'
import type { CycleStatus, SettledCycleStatus } from '../../../shared/agent/react-cycle'
import type { RunGuardSnapshot } from '../../../shared/agent/run-guard'

export function nextAction(status: CycleStatus | null) {
  switch (status) {
    case null:
    case 'CONTINUE': return 'CONTINUE'
    case 'WARNING': return 'CONTINUE_WITH_WARNING'
    case 'RECOVERING': return 'RECOVER'
    case 'SUCCESS':
    case 'FAILED':
    case 'CANCELLED': return 'STOP'
    case 'RUNNING': throw new AgentError('AGENT_PROTOCOL_ERROR')
  }
}

export function startCycle(previous: CycleStatus | null): CycleStatus {
  if (nextAction(previous) === 'STOP') throw new AgentError('AGENT_PROTOCOL_ERROR')
  return 'RUNNING'
}

export function settleCycle(current: CycleStatus | null, outcome: SettledCycleStatus): SettledCycleStatus {
  if (current !== 'RUNNING') throw new AgentError('AGENT_PROTOCOL_ERROR')
  return outcome
}

export function resolveCycle(input: {
  fatal: boolean; cancelled: boolean; finalAnswer: boolean; guard?: RunGuardSnapshot
}): SettledCycleStatus {
  if (input.fatal || input.guard?.status === 'BLOCKED') return 'FAILED'
  if (input.cancelled) return 'CANCELLED'
  if (input.finalAnswer) return 'SUCCESS'
  if (input.guard?.level === 'recovery') return 'RECOVERING'
  if (input.guard?.level === 'warning') return 'WARNING'
  return 'CONTINUE'
}
