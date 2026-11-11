import type { AgentPhase } from './index'

export const cycleStatuses = ['RUNNING', 'CONTINUE', 'WARNING', 'RECOVERING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const
export type CycleStatus = typeof cycleStatuses[number]
export type SettledCycleStatus = Exclude<CycleStatus, 'RUNNING'>
export type TerminalCycleStatus = Extract<CycleStatus, 'SUCCESS' | 'FAILED' | 'CANCELLED'>
export interface ReActCycle {
  index: number
  phase: AgentPhase
  status: CycleStatus
  reason: string | null
  modelRequestOrdinal: number | null
  toolCallIds: string[]
  startedAt: string
  finishedAt: string | null
}
