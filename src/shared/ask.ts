import type { AgentMessage } from './agent'
import type { ModelCapabilities } from './ai'

export const askContextDefaults = {
  safetyRatio: 0.05,
  compactionTriggerRatio: 0.8, compactionTargetRatio: 0.6,
  summaryMaxTokens: 4096, coreMemoryMaxTokens: 2048, memoryRecallTokens: 2048, toolSchemaMaxTokens: 8192
} as const
export interface ContextCheckpoint { summary: string; compactedThroughSequence: number; revision: number }
export interface ContextTurn { sequence: number; messages: AgentMessage[] }
export type AskRuntimeStatus = 'pending' | 'context.compacting' | 'human.waiting' | 'idle'
export interface AskRuntimeOptions { capabilities: ModelCapabilities; modelId: string }
