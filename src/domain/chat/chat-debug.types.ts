/** Existing transcript sections preserve raw persisted columns, including JSON text and numeric flags. */
export interface DebugSession {
  id: string; title: string; provider_id: string; model_id: string; created_at: string; updated_at: string
}
export interface DebugRun {
  id: string; session_id: string; provider_id: string; model_id: string; state: string; error: string | null
  event_sequence: number; write_started: number; request_id: string; request_hash: string; owner_runtime_id: string
  created_at: string; finished_at: string | null; admission: string; runtime_status: string
}
export interface DebugItem {
  id: string; session_id: string; run_id: string; sequence: number; state: string; content_json: string; created_at: string; updated_at: string
}
export interface DebugModelRequest { run_id: string; ordinal: number; metadata_json: string; activations_json: string }
export interface DebugProviderResponse { run_id: string; ordinal: number; through_sequence: number; response_json: string }
export interface DebugCheckpoint { session_id: string; summary: string; compacted_through_sequence: number; revision: number; protected_json: string }
export interface DebugMemoryProgress { message_id: string; session_id: string; sequence: number; progress_json: string }
export interface DebugCycle {
  index: number; status: string; reason: string | null; modelRequestOrdinal: number | null
  toolCallIds: string[]; startedAt: string; finishedAt: string | null
}
export interface ChatDebugData {
  session: DebugSession
  runs: { run: DebugRun; items: DebugItem[]; modelRequests: DebugModelRequest[]; providerResponses: DebugProviderResponse[]; cycles: DebugCycle[]; cycleStatus: string | null }[]
  context: { checkpoint: DebugCheckpoint | null; memoryProgress: DebugMemoryProgress[] }
}
export interface ChatDebugBundle extends ChatDebugData {
  format: 'jab-debug'; schemaVersion: 2; exportedAt: string
  app: { version: string; commit: string | null; platform: string }
}
export interface ChatDebugRepository { getDebugBundle(sessionId: string): ChatDebugData }
export interface ChatDebugOutput { copy(data: ChatDebugData): Promise<null> }
