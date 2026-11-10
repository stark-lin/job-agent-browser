import type { RunGuardSnapshot } from '../../shared/tools/index'
/** Host-owned conversation records; these never grant business capability access. */
export interface ChatChoice { providerId: string; modelId: string }
export interface ChatSession extends ChatChoice { id: string; title: string; createdAt: string; updatedAt: string }
export type ChatRunState = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type ChatItemState = 'streaming' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain' | 'interrupted'
export interface AgentRun<S extends string | null = string | null> extends ChatChoice {
  id: string; sessionId: S; state: ChatRunState; error: string | null; eventSequence: number
  writeStarted: boolean; createdAt: string; finishedAt: string | null
  admission?: 'pending' | 'admitted'
  runtimeStatus?: RuntimeStatus
}
export type ChatRun = AgentRun<string>
export type ToolSummaryKey = 'scope' | 'humanAsk' | 'memoryRead' | 'memoryWrite' | 'knowledgeRead' | 'knowledgeWrite' | 'profileItems' | 'createProfile' | 'updateProfile' | 'addProfileItem' | 'updateProfileItem' | 'addProfileFact' | 'updateProfileFact' | 'jobs' | 'job' | 'updateJob' | 'archiveJob' | 'profiles' | 'profile' | 'facts'
  | 'application' | 'events' | 'setStatus' | 'addNote' | 'schedule' | 'reschedule' | 'artifact' | 'tool'
  | 'importJob' | 'startResume' | 'resumeContext' | 'resumeFacts' | 'resumeBullets' | 'optimizeResume' | 'scoreResume' | 'checkResume' | 'selectResume' | 'draftResume' | 'polishResume' | 'publishResume' | 'failResume' | 'cancelResume' | 'buildArtifact' | 'searchTools' | 'activateTools'
export interface ToolDisplay { key: ToolSummaryKey; count?: number; status?: string; startsAt?: string }
export interface ChatReasoning { source: string; kind: 'text' | 'summary' | 'encrypted'; blockId?: string }
export type ChatContent = { type: 'user_message'; text: string; source?: 'smart-paste' }
  | { type: 'assistant_message' | 'reasoning'; text: string; reasoning?: ChatReasoning }
  | { type: 'tool_call'; toolName: string; display: ToolDisplay; durationMs?: number; error?: string; callId?: string; arguments?: unknown; result?: unknown; guard?: RunGuardSnapshot }
export interface AgentItem<S extends string | null = string | null> {
  id: string; sessionId: S; runId: string; sequence: number; state: ChatItemState; content: ChatContent
  createdAt: string; updatedAt: string
}
export type ChatItem = AgentItem<string>
export interface AgentSnapshot<S extends string | null = string | null> { run: AgentRun<S>; items: AgentItem<S>[] }
export type ChatSnapshot = AgentSnapshot<string>
export type RuntimeStatus = 'pending' | 'context.compacting' | 'human.waiting' | 'tools.searching' | 'tools.activating' | 'idle'
export type AgentRunEvent<S extends string | null = string> = { sessionId: S; runId: string; eventSequence: number } & (
  { type: 'run.started'; run: AgentRun<S> }
  | { type: 'runtime.status'; status: RuntimeStatus; run: AgentRun<S> }
  | { type: 'item.started' | 'item.completed' | 'item.failed'; item: AgentItem<S> }
  | { type: 'item.delta'; itemId: string; delta: string }
  | { type: 'run.completed' | 'run.failed' | 'run.cancelled' | 'run.interrupted'; run: AgentRun<S> }
)
export interface ChatPage<T> { items: T[]; total: number }
export interface ChatPreparedTool { name: string; providerName: string; schemaHash: string }
export interface ChatActivationDiagnostic { names: string[]; repeats: number; reason: 'already-active' | 'activation-loop' }
/** Conversation projection, structurally matching the runtime's pure diagnostic contract. */
export interface ChatModelRequest {
  runId: string; ordinal: number; providerId: string; modelId: string; preparedAt: string
  purpose: 'agent-turn' | 'context-summary'; loadoutVersion: number
  expectedTools: ChatPreparedTool[]; piTools: ChatPreparedTool[]; tools: ChatPreparedTool[]
  verification: 'matched' | 'mismatch'; activations: ChatActivationDiagnostic[]
}
export interface ChatStart { requestId: string; sessionId?: string; message: string; choice: ChatChoice }
