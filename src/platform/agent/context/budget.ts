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
    if (!Number.isSafeInteger(capabilities.contextWindow) || !Number.isSafeInteger(capabilities.maxOutputTokens)
      || capabilities.contextWindow <= 0 || capabilities.maxOutputTokens <= 0) throw new AgentError('ASK_CONTEXT_UNKNOWN')
    this.safety = Math.max(Math.min(4096, Math.floor(capabilities.contextWindow / 4)), Math.ceil(defaults.safetyRatio * capabilities.contextWindow))
    const available = capabilities.contextWindow - this.safety
    if (available < 2) throw new AgentError('ASK_CONTEXT_TOO_SMALL')
    // Keep at least half the usable window for input when the output limit approaches the full window.
    this.output = Math.min(capabilities.maxOutputTokens, Math.floor(available / 2))
    this.input = available - this.output
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
