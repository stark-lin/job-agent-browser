import { AgentError, type AgentToolDescriptor, type AgentTools } from '../../../shared/agent'
import { allowedAskTool } from '../../../shared/agent/ask-policy'
import { agentScopeForTool, allowsAgentControl } from '../../../shared/agent/context-policy'
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
    const allowed = listed.filter(tool => this.allows(tool.name)).map(tool => tool.name)
    this.catalog = listed.filter(tool => allowed.includes(tool.name) || allowsAgentControl(tool.name, allowed))
  }
  snapshot() { return { version: this.version, tools: structuredClone(this.current) } }
  confirmRequest(_names: readonly string[]) {}
  loadout() {
    const next = this.catalog.filter(tool => tool.name.startsWith('scope.') || tool.name === 'human.ask' || this.expanded.has(agentScopeForTool(tool.name)))
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
