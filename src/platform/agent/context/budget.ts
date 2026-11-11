import { AgentError, type AgentMessage, type AgentToolDescriptor } from '../../../shared/agent'
import type { ModelCapabilities } from '../../../shared/ai'
import { askContextDefaults as defaults } from '../../../shared/ask'
import { TokenCounter } from './tokenizer'

export class ContextBudget {
  readonly output: number
  readonly safety: number
  readonly input: number
  readonly tokens: TokenCounter
  constructor(readonly capabilities: ModelCapabilities, modelId: string) {
    const window = capabilities.contextWindow
    if (window < 2) throw new AgentError('ASK_CONTEXT_OVERFLOW')
    this.safety = Math.min(window - 2, Math.max(Math.min(4096, Math.ceil(window / 8)), Math.ceil(defaults.safetyRatio * window)))
    this.output = Math.min(defaults.outputReserveTokens, capabilities.maxOutputTokens, window - this.safety - 1)
    this.input = window - this.output - this.safety
    this.tokens = new TokenCounter(modelId)
  }
  estimate(messages: readonly AgentMessage[], tools: readonly AgentToolDescriptor[]) {
    return this.tokens.count(messages) + this.tokens.count(tools) + 32 * (messages.length + tools.length + 1)
  }
  assert(messages: readonly AgentMessage[], tools: readonly AgentToolDescriptor[]) {
    const estimated = this.estimate(messages, tools)
    if (estimated > this.input) throw new AgentError('ASK_CONTEXT_OVERFLOW')
    return estimated
  }
}
