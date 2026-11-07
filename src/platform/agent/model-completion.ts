import { abortable, AgentError, type AgentMessage, type AgentModel } from '../../shared/agent'

/** Host-side parsing tasks request a single text completion without capabilities. */
export async function completeAgentText(model: AgentModel, messages: AgentMessage[], signal: AbortSignal) {
  signal.throwIfAborted()
  const response = await abortable(model.complete({ messages: structuredClone(messages), tools: [], signal }), signal)
  signal.throwIfAborted()
  if (!response || typeof response.content !== 'string' || !response.content.trim() || !Array.isArray(response.toolCalls) || response.toolCalls.length) {
    throw new AgentError('AGENT_PROTOCOL_ERROR')
  }
  return response.content
}
