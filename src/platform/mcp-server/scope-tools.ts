import type { AgentToolDescriptor } from '../../shared/agent'
import { agentScopes } from '../../shared/agent/context-policy'

/** Directories are built from the server's already filtered descriptors. */
export function scopeTools(catalog: readonly AgentToolDescriptor[]): AgentToolDescriptor[] {
  return agentScopes.filter(domain => catalog.some(tool => tool.name.startsWith(`${domain}.`))).map(domain => ({
    name: `scope.${domain}`, description: `Inspect authorized ${domain} operations. Call these business tools directly on the next model request.`, risk: 'READ',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }))
}
export function scopeDirectory(name: string, catalog: readonly AgentToolDescriptor[]) {
  const domain = name.slice('scope.'.length)
  return { scope: domain, tools: catalog.filter(tool => tool.name.startsWith(`${domain}.`)).map(tool => ({ name: tool.name, description: tool.description, risk: tool.risk ?? 'WRITE' })) }
}
