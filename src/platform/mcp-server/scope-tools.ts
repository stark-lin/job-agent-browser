import type { AgentToolDescriptor } from '../../shared/agent'
import { agentScopeForTool, agentScopes } from '../../shared/agent/context-policy'

/** Directories are built from the server's already filtered descriptors. */
export function scopeTools(catalog: readonly AgentToolDescriptor[]): AgentToolDescriptor[] {
  return agentScopes.filter(scope => catalog.some(tool => agentScopeForTool(tool.name) === scope)).map(scope => ({
    name: `scope.${scope}`, description: `Inspect authorized ${scope === 'job' ? 'job and application' : scope} operations. Call these business tools directly on the next model request.`, risk: 'READ',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }))
}
export function scopeDirectory(name: string, catalog: readonly AgentToolDescriptor[]) {
  const scope = name.slice('scope.'.length)
  return { scope, tools: catalog.filter(tool => agentScopeForTool(tool.name) === scope).map(tool => ({ name: tool.name, description: tool.description, risk: tool.risk ?? 'WRITE' })) }
}
