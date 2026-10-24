import { abortable, AgentError, type AgentMessage, type AgentModel, type AgentTools } from '../../shared/agent'
import { ToolError } from '../../shared/tools/errors'

/** A bounded sequential conversation. Domain stages decide what the final text means. */
export async function runAgent(model: AgentModel, tools: AgentTools | undefined, initial: AgentMessage[], signal: AbortSignal): Promise<string> {
  const messages = structuredClone(initial), seen = new Set<string>()
  const descriptors = tools ? await abortable(tools.list(), signal) : []
  for (let step = 0; step < 8; step++) {
    if (signal.aborted) throw new AgentError('AGENT_CANCELLED')
    const response = await abortable(model.complete({ messages: structuredClone(messages), tools: descriptors, signal }), signal)
    if (signal.aborted) throw new AgentError('AGENT_CANCELLED')
    if (!response || typeof response.content !== 'string' || !Array.isArray(response.toolCalls) || response.toolCalls.length > 32) throw new AgentError('AGENT_PROTOCOL_ERROR')
    for (const call of response.toolCalls) {
      if (!call || typeof call.id !== 'string' || !call.id || typeof call.name !== 'string' || !call.name || seen.has(call.id)) throw new AgentError('AGENT_PROTOCOL_ERROR')
      seen.add(call.id)
    }
    if (!response.toolCalls.length) {
      if (!response.content.trim()) throw new AgentError('AGENT_PROTOCOL_ERROR')
      return response.content
    }
    if (!tools) throw new AgentError('AGENT_PROTOCOL_ERROR')
    messages.push({ role: 'assistant', ...structuredClone(response) })
    for (const call of response.toolCalls) {
      if (signal.aborted) throw new AgentError('AGENT_CANCELLED')
      let observation: string
      try { observation = JSON.stringify(await abortable(tools.call(call.name, call.arguments, signal), signal)) }
      catch (error) {
        if (signal.aborted || error instanceof AgentError || error instanceof ToolError && ['TOOL_CANCELLED', 'TOOL_AUDIT_UNAVAILABLE'].includes(error.code)) throw error
        observation = JSON.stringify({ error: error instanceof ToolError ? error.code : 'TOOL_EXECUTION_FAILED' })
      }
      if (signal.aborted) throw new AgentError('AGENT_CANCELLED')
      messages.push({ role: 'tool', callId: call.id, content: observation })
    }
  }
  throw new AgentError('AGENT_STEP_LIMIT')
}
