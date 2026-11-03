import { AgentError, type AgentToolDescriptor, type AgentTools } from '../../../shared/agent'
import type { ContextBudget } from '../context/budget'

export const discoveryTools: AgentToolDescriptor[] = [
  { name: 'tool.search', description: 'Find authorized tools by task, keywords or namespace. Returns names, purposes and risks, not full schemas.', risk: 'READ', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 2048 } }, required: ['query'], additionalProperties: false } },
  { name: 'tool.activate', description: 'Activate only the tool names needed for this task. Activation never changes authorization. Takes effect at the next model request.', risk: 'READ', inputSchema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 16 } }, required: ['names'], additionalProperties: false } }
]
export function allowedAskTool(name: string) { return !/(?:^|[._])delete(?:$|[._])/i.test(name) && !['memory.write', 'memory.mkdir'].includes(name) }

export class ToolDiscovery {
  private active: string[] = []
  private desired: string[] = []
  private catalog: readonly AgentToolDescriptor[] = []
  constructor(private readonly tools: AgentTools, private readonly budget: ContextBudget) {}
  async refresh() { this.catalog = (await this.tools.list()).filter(t => allowedAskTool(t.name)); this.active = this.active.filter(n => this.catalog.some(t => t.name === n)) }
  loadout(): AgentToolDescriptor[] {
    this.active = this.desired.filter(n => this.catalog.some(t => t.name === n))
    return [...discoveryTools, ...this.active.map(n => this.catalog.find(t => t.name === n)!)]
  }
  async call(name: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    const args = input as Record<string, unknown>
    if (name === 'tool.search') {
      const words = String(args.query).toLowerCase().match(/[\p{L}\p{N}_.]+/gu) ?? []
      return this.catalog.map(tool => ({ tool, score: words.reduce((sum, word) => sum + (`${tool.name} ${tool.description}`.toLowerCase().includes(word) ? 1 : 0), 0) }))
        .filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name)).slice(0, 8)
        .map(({ tool }) => ({ name: tool.name, description: tool.description, namespace: tool.name.split('.')[0], risk: tool.risk ?? 'WRITE', schemaTokens: this.budget.tokens.count(tool.inputSchema) }))
    }
    if (name === 'tool.activate') {
      await this.refresh()
      const names = args.names as string[]
      if (!Array.isArray(names) || names.some(n => !this.catalog.some(t => t.name === n))) throw new AgentError('AGENT_PROTOCOL_ERROR')
      const keep = [...new Set([...this.desired.filter(n => !names.includes(n)), ...names])]
      const soft = Math.min(8192, Math.floor(this.budget.input * 0.08))
      while (keep.length > names.length && (keep.length > 8 || this.budget.tokens.count(keep.map(n => this.catalog.find(t => t.name === n))) > soft)) keep.shift()
      if (this.budget.tokens.count(keep.map(n => this.catalog.find(t => t.name === n))) > this.budget.input) throw new AgentError('ASK_CONTEXT_OVERFLOW')
      this.desired = keep
      return { activeOnNextRequest: keep }
    }
    if (!this.active.includes(name) || !allowedAskTool(name)) throw new AgentError('AGENT_PROTOCOL_ERROR')
    return this.tools.call(name, input, signal)
  }
}
