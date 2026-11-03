import { AgentError, type ActivationDiagnostic, type AgentToolDescriptor, type AgentTools } from '../../../shared/agent'
import type { ContextBudget } from '../context/budget'
import { fingerprint } from '../../ai/agent-request'

export const discoveryTools: AgentToolDescriptor[] = [
  { name: 'tool.search', description: 'Find authorized tools by task, keywords or namespace. Returns names, purposes and risks, not full schemas.', risk: 'READ', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 2048 } }, required: ['query'], additionalProperties: false } },
  { name: 'tool.activate', description: 'Activate only the tool names needed for this task. Activation never changes authorization. Takes effect at the next model request.', risk: 'READ', inputSchema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 16 } }, required: ['names'], additionalProperties: false } }
]
export function allowedAskTool(name: string) { return !/(?:^|[._])delete(?:$|[._])/i.test(name) }

export class ToolDiscovery {
  private active: string[] = []
  private desired: string[] = []
  private catalog: readonly AgentToolDescriptor[] = []
  private advertised = new Set<string>()
  private repeats = new Map<string, number>()
  private current: AgentToolDescriptor[] = []
  private version = 0
  constructor(private readonly tools: AgentTools, private readonly budget: ContextBudget, private readonly diagnose: (value: ActivationDiagnostic) => void = () => {}) {}
  async refresh() {
    const catalog = (await this.tools.list()).filter(t => allowedAskTool(t.name))
    const signature = (items: readonly AgentToolDescriptor[]) => fingerprint([...items].sort((a, b) => a.name.localeCompare(b.name)))
    if (signature(catalog) !== signature(this.catalog)) { this.repeats.clear(); this.advertised.clear(); this.version++ }
    this.catalog = catalog
    this.active = this.active.filter(n => catalog.some(t => t.name === n))
    this.desired = this.desired.filter(n => catalog.some(t => t.name === n))
  }
  snapshot() { return { version: this.version, tools: structuredClone(this.current) } }
  confirmRequest(names: readonly string[]) { this.advertised = new Set(names) }
  loadout(): AgentToolDescriptor[] {
    this.active = this.desired.filter(n => this.catalog.some(t => t.name === n))
    const next = [...discoveryTools, ...this.active.map(n => this.catalog.find(t => t.name === n)!)]
    if (fingerprint(next) !== fingerprint(this.current)) { this.version++; this.repeats.clear() }
    this.current = next
    return structuredClone(next)
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
      if (!Array.isArray(args.names) || !args.names.length || args.names.length > 16 || args.names.some(n => typeof n !== 'string' || !this.catalog.some(t => t.name === n))) throw new AgentError('AGENT_PROTOCOL_ERROR')
      const names = [...new Set(args.names as string[])].sort()
      const alreadyActive = names.filter(n => this.active.includes(n) && this.advertised.has(n))
      const updating = names.some(n => !this.desired.includes(n))
      const keep = updating ? [...this.desired.filter(n => !names.includes(n)), ...names] : [...this.desired]
      const soft = Math.min(8192, Math.floor(this.budget.input * 0.08))
      while (updating && keep.length > names.length && (keep.length > 8 || this.budget.tokens.count(keep.map(n => this.catalog.find(t => t.name === n))) > soft)) keep.shift()
      if (this.budget.tokens.count(keep.map(n => this.catalog.find(t => t.name === n))) > this.budget.input) throw new AgentError('ASK_CONTEXT_OVERFLOW')
      const changed = fingerprint([...keep].sort()) !== fingerprint([...this.desired].sort())
      if (changed) this.repeats.clear()
      else if (alreadyActive.length === names.length) {
        const key = JSON.stringify(names), repeats = (this.repeats.get(key) ?? 0) + 1
        this.repeats.set(key, repeats)
        this.diagnose({ names, repeats, reason: repeats >= 2 ? 'activation-loop' : 'already-active' })
        if (repeats >= 2) throw new AgentError('AGENT_STEP_LIMIT')
      }
      this.desired = keep
      return { activeOnNextRequest: keep, alreadyActive, changed, nextAction: `Call ${names.join(', ')} directly on the next request; do not reactivate available tools.` }
    }
    if (!this.active.includes(name) || !allowedAskTool(name)) throw new AgentError('AGENT_PROTOCOL_ERROR')
    const result = await this.tools.call(name, input, signal)
    this.repeats.clear()
    return result
  }
}
