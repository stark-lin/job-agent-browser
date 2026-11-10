/** Reference spaces never establish personal experience; Profile/Facts do. */
export const knowledgeAgentTools = ['knowledge.list', 'knowledge.read', 'knowledge.search', 'knowledge.retrieve'] as const
export const memoryAgentTools = ['memory.list', 'memory.read', 'memory.recall', 'memory.write', 'memory.mkdir'] as const
export const agentScopes = ['job', 'profile', 'application', 'resume', 'artifact', 'knowledge', 'memory'] as const
export function allowsAgentControl(name: string, allow: readonly string[]) {
  return name === 'human.ask' || (name.startsWith('scope.') && agentScopes.some(domain => name === `scope.${domain}` && allow.some(tool => tool.startsWith(`${domain}.`))))
}
