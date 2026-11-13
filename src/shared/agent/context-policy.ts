/** Reference spaces never establish personal experience; Profile/Facts do. */
export const knowledgeAgentTools = ['knowledge.list', 'knowledge.read', 'knowledge.search', 'knowledge.retrieve'] as const
export const memoryAgentTools = ['memory.list', 'memory.read', 'memory.recall', 'memory.write', 'memory.mkdir'] as const
export const agentScopes = ['job', 'profile', 'resume', 'artifact', 'knowledge', 'memory'] as const
export function agentScopeForTool(name: string) {
  const namespace = name.split('.', 1)[0]
  return namespace === 'application' ? 'job' : namespace
}
export function allowsAgentControl(name: string, allow: readonly string[]) {
  return name === 'human.ask' || agentScopes.some(scope => name === `scope.${scope}` && allow.some(tool => agentScopeForTool(tool) === scope))
}
