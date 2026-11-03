import { createHash } from 'node:crypto'
import { AgentError, type AgentToolDescriptor, type PreparedRequest, type PreparedTool, type RequestContext } from '../../shared/agent'
import { providerTools } from './agent-protocol'

/** Sort object keys recursively; array order is part of the schema. */
export function fingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)])) : item
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
export function preparedTools(mapped: ReturnType<typeof providerTools>): PreparedTool[] {
  const reverse = new Map([...mapped.names].map(([name, alias]) => [alias, name]))
  return mapped.tools.map(({ function: fn }) => ({ name: reverse.get(fn.name)!, providerName: fn.name, schemaHash: fingerprint(fn.parameters) }))
}
export const toolSnapshot = (tools: readonly AgentToolDescriptor[], stable = true) => preparedTools(providerTools(tools, stable))
export function matchesRequest(request: PreparedRequest, context: RequestContext): boolean {
  const sorted = (tools: PreparedTool[]) => [...tools].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  return new Set(request.tools.map(t => t.name)).size === request.tools.length
    && new Set(request.tools.map(t => t.providerName)).size === request.tools.length
    && fingerprint(sorted(context.expectedTools)) === fingerprint(sorted(context.piTools))
    && fingerprint(sorted(context.expectedTools)) === fingerprint(sorted(request.tools))
}
export function verifyRequest(request: PreparedRequest, context: RequestContext) {
  if (!matchesRequest(request, context)) throw new AgentError('AGENT_PROTOCOL_ERROR')
}
