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
    if (!capabilities.verified || !Number.isSafeInteger(capabilities.contextWindow) || !Number.isSafeInteger(capabilities.maxOutputTokens)
      || capabilities.maxOutputTokens <= 0) throw new AgentError('ASK_CONTEXT_UNKNOWN')
    if (capabilities.contextWindow < defaults.minContextWindow) throw new AgentError('ASK_CONTEXT_TOO_SMALL')
    this.output = Math.min(defaults.outputReserveTokens, capabilities.maxOutputTokens)
    this.safety = Math.max(4096, Math.ceil(defaults.safetyRatio * capabilities.contextWindow))
    this.input = capabilities.contextWindow - this.output - this.safety
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
