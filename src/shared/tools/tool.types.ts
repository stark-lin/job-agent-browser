export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonSchema = Record<string, unknown>
export type ToolRisk = 'READ' | 'COMPUTE' | 'WRITE' | 'EXTERNAL_ACTION'
export type ToolMode = 'read' | 'write'
export type ToolSource = { type: 'native' } | { type: 'mcp'; serverId: string; originalName: string }

export interface ToolDescriptor {
  readonly name: string
  readonly source: ToolSource
  readonly description: string
  readonly inputSchema: JsonSchema
  readonly outputSchema?: JsonSchema
  readonly risk: ToolRisk
  readonly mode: ToolMode
  readonly tags: readonly string[]
}
export interface ToolOutput {
  content: { type: 'text'; text: string }[]
  structuredContent?: JsonValue
}
/** Created by the Main composition root, never from model arguments or Renderer input. */
export interface ToolCaller { agentId: string; runId?: string; signal: AbortSignal }
export interface ToolExecutionContext extends ToolCaller { invocationId: string }
/** Internal registration: callers receive descriptors and a scope, never this execution function. */
export interface RegisteredTool {
  descriptor: ToolDescriptor
  execute(input: unknown, caller: ToolCaller): Promise<ToolOutput>
}
export interface ToolScopePolicy { allow: readonly string[]; deny?: readonly string[]; maxRisk?: ToolRisk }
export interface ToolScope {
  get(name: string): ToolDescriptor | null
  list(): ToolDescriptor[]
  execute(name: string, input: unknown): Promise<ToolOutput>
  dispose(): void
}
