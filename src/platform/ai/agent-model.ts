import { AgentError, abortable, type StreamingAgentModel, type AgentResponse } from '../../shared/agent'
import { providerTools, providerMessages, parseAgentResponse, protocol } from './agent-protocol'
import { agentStream } from './agent-stream'
import type { ChatRequest, Fetch } from './compatible'
import { outputTokenParameters, postChat, requestTimeout } from './transport'
import { DataError } from '../../domain/common/errors'
import { preparedTools } from './agent-request'

export function compatibleAgentModel(config: Omit<ChatRequest, 'messages'>, deps: {
  transport?: Fetch; timeoutMs?: number
} = {}): StreamingAgentModel {
  const snapshot = structuredClone(config)
  return { stream: input => agentStream(snapshot, deps, input), async complete(input) {
    const timeout = requestTimeout(input.signal, deps.timeoutMs)
    let result: AgentResponse | undefined, failure: unknown
    try {
      const mapped = providerTools(input.tools, input.stableToolNames)
      const body = { messages: providerMessages(input.messages, mapped.names, input.stableToolNames), ...(mapped.tools.length ? { tools: mapped.tools } : {}), ...outputTokenParameters(snapshot, input.maxOutputTokens) }
      input.validateRequest?.({ model: snapshot.model, ...body, stream: false })
      input.onRequestPrepared?.({ providerId: snapshot.provider.id, modelId: snapshot.model, preparedAt: new Date().toISOString(), tools: preparedTools(mapped) })
      const pending = (async () => {
        const reply = await postChat(snapshot, body, timeout.signal, false, deps.transport)
        if (!reply.headers.get('content-type')?.toLowerCase().includes('application/json')) { await reply.body?.cancel(); protocol() }
        const reader = reply.body?.getReader()
        if (!reader) protocol()
        const chunks: Uint8Array[] = []; let length = 0
        try {
          for (;;) {
            const part = await reader.read(); if (part.done) break
            length += part.value.length; if (length > 1000000) protocol()
            chunks.push(part.value)
          }
          return parseAgentResponse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))), mapped.names)
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      })()
      result = await abortable(pending, timeout.signal)
      timeout.signal.throwIfAborted()
    } catch (error) {
      failure = input.signal.aborted ? new AgentError('AGENT_CANCELLED') : timeout.timedOut() ? new AgentError('AGENT_TIMEOUT')
        : error instanceof AgentError || error instanceof DataError ? error : new AgentError(error instanceof SyntaxError || error instanceof TypeError && String(error).includes('encoded') ? 'AGENT_PROTOCOL_ERROR' : 'AI_CONNECT_FAILED')
    } finally { timeout.dispose() }
    if (failure) throw failure
    return result!
  } }
}
