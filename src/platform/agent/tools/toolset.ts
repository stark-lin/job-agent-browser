import type { AgentToolDescriptor } from '../../../shared/agent'


export interface AgentToolset {
  refresh(): Promise<void>
  loadout(): AgentToolDescriptor[]
  snapshot(): { version: number; tools: AgentToolDescriptor[] }
  confirmRequest(names: readonly string[]): void
  call(name: string, args: unknown, signal: AbortSignal): Promise<unknown>
}
