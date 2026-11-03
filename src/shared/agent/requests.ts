/** Request diagnostics contain names and fingerprints only, never request bodies. */
export interface PreparedTool { name: string; providerName: string; schemaHash: string }
export interface PreparedRequest { providerId: string; modelId: string; preparedAt: string; tools: PreparedTool[] }
export interface RequestContext {
  purpose: 'agent-turn' | 'context-summary'
  loadoutVersion: number
  expectedTools: PreparedTool[]
  piTools: PreparedTool[]
}
export interface RequestDiagnostic extends PreparedRequest, RequestContext {
  ordinal: number
  verification: 'matched' | 'mismatch'
}
export interface ActivationDiagnostic { names: string[]; repeats: number; reason: 'already-active' | 'activation-loop' }
