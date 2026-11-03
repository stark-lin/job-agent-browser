import { AgentError, abortable, type AgentModel, type AgentMessage } from '../../../shared/agent'
import type { ContextBudget } from './budget'

/** One bounded model task; no tools and no agent loop. */
export async function modelTask(model: AgentModel, budget: ContextBudget, instruction: string, data: unknown, maxTokens: number, signal: AbortSignal): Promise<string> {
  const messages: AgentMessage[] = [{ role: 'system', content: instruction }, { role: 'user', content: JSON.stringify(data) }]
  budget.assert(messages, [])
  const estimated = budget.assert(messages, [])
  const result = await abortable(model.complete({ messages, tools: [], signal, maxOutputTokens: Math.min(maxTokens, budget.output), validateRequest(payload) {
    if (budget.tokens.count(payload) > budget.input) throw new AgentError('ASK_CONTEXT_OVERFLOW')
  } }), signal)
  if (result.usage) budget.tokens.observe(estimated, result.usage.inputTokens)
  if (result.toolCalls.length || !result.content.trim() || budget.tokens.count(result.content) > maxTokens) throw new AgentError('AGENT_PROTOCOL_ERROR')
  return result.content
}
