/** Display metadata contains no signatures or encrypted provider payloads. */
export interface ReasoningInfo {
  source: 'reasoning_content' | 'reasoning' | 'reasoning_summary' | 'reasoning_details'
  kind: 'text' | 'summary' | 'encrypted'
  blockId?: string
}
/** Host-only continuation state; never include this in renderer events. */
export interface ProviderReasoning {
  reasoning_content?: string
  reasoning?: string
  reasoning_summary?: string
  reasoning_details?: Record<string, unknown>[]
}
