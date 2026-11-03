import type { AgentMessage } from './agent'
import type { ModelCapabilities } from './ai'

export const askContextDefaults = {
  minContextWindow: 65536, outputReserveTokens: 8192, safetyRatio: 0.05,
  compactionTriggerRatio: 0.8, compactionTargetRatio: 0.6,
  summaryMaxTokens: 4096, coreMemoryMaxTokens: 1024, memoryRecallTokens: 2048, toolSchemaMaxTokens: 8192
} as const
export interface ContextCheckpoint { summary: string; compactedThroughSequence: number; revision: number }
export interface ContextTurn { sequence: number; messages: AgentMessage[] }
export type MemoryPhase = 'pending' | 'extracting' | 'consolidating' | 'committing' | 'committed' | 'no_change' | 'failed'
export interface MemoryWriteIntent { path: string; content: string; expectedRevision: string | null; digest: string; committedRevision?: string }
/** A replaceable recovery checkpoint, not an extraction event log. Never exposed to the renderer. */
export interface MemoryProgress {
  messageId: string; sequence: number; phase: MemoryPhase; writes: MemoryWriteIntent[]; nextWrite: number; error: string | null
}
export type AskRuntimeStatus = 'pending' | 'memory.updating' | 'memory.failed' | 'context.compacting' | 'tools.searching' | 'tools.activating' | 'idle'
export interface AskRuntimeOptions { capabilities: ModelCapabilities; modelId: string }
