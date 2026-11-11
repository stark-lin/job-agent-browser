import { AgentError, type AgentToolDescriptor, type AgentTools } from '../../../shared/agent'
import { allowedAskTool } from '../../../shared/agent/ask-policy'
import type { AgentToolset } from './toolset'
import type { ContextBudget } from '../context/budget'
import { fingerprint } from '../../ai/agent-request'

/** A new instance belongs to exactly one Run; expansion never changes authorization. */
export class ScopedToolset implements AgentToolset {
  private catalog: AgentToolDescriptor[] = []
  private expanded = new Set<string>()
  private current: AgentToolDescriptor[] = []
  private version = 0
  constructor(private readonly tools: AgentTools, private readonly budget: ContextBudget, private readonly allows = allowedAskTool) {}
  async refresh() {
    const listed = await this.tools.list()
    this.catalog = listed.filter(tool => this.allows(tool.name) || tool.name === 'human.ask' || tool.name.startsWith('scope.') && listed.some(business => this.allows(business.name) && business.name.startsWith(`${tool.name.slice(6)}.`)))
  }
  snapshot() { return { version: this.version, tools: structuredClone(this.current) } }
  confirmRequest(_names: readonly string[]) {}
  loadout() {
    const next = this.catalog.filter(tool => tool.name.startsWith('scope.') || tool.name === 'human.ask' || this.expanded.has(tool.name.split('.')[0]))
    if (this.budget.tokens.count(next) > this.budget.input) throw new AgentError('ASK_CONTEXT_OVERFLOW')
    if (fingerprint(next) !== fingerprint(this.current)) this.version++
    this.current = next
    return structuredClone(next)
  }
  async call(name: string, args: unknown, signal: AbortSignal) {
    if (!this.current.some(tool => tool.name === name)) throw new AgentError('AGENT_PROTOCOL_ERROR')
    if (name.startsWith('scope.')) {
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new AgentError('AGENT_PROTOCOL_ERROR')
      const result = await this.tools.call(name, args, signal)
      this.expanded.add(name.slice(6))
      return result
    }
    return this.tools.call(name, args, signal)
  }
}
