import { AgentError, type AgentModelInput, type AgentRuntimeEvent, type StreamingAgentModel } from '../../../shared/agent'
import { matchesRequest, toolSnapshot } from '../../ai/agent-request'

/** Main supplies the sink; this adapter neither owns storage nor invokes business services. */
export function observeAskModel(model: StreamingAgentModel, emit: (event: AgentRuntimeEvent) => void): StreamingAgentModel {
  let ordinal = 0, requests = 0
  const reserve = () => { if (++requests > 64) throw new AgentError('AGENT_STEP_LIMIT') }
  const observe = (input: AgentModelInput): AgentModelInput => ({ ...input, onRequestPrepared(request) {
    input.signal.throwIfAborted()
    const context = input.requestContext ?? { purpose: 'context-summary' as const, loadoutVersion: 0,
      expectedTools: toolSnapshot(input.tools, input.stableToolNames ?? false), piTools: toolSnapshot(input.tools, input.stableToolNames ?? false) }
    const { cycleIndex, ...diagnostic } = context
    const matched = matchesRequest(request, context)
    emit({ type: 'model.request.prepared', request: { ...request, ...diagnostic, ordinal: ++ordinal, verification: matched ? 'matched' : 'mismatch' }, cycleIndex })
    if (!matched) throw new AgentError('AGENT_PROTOCOL_ERROR')
    input.onRequestPrepared?.(request)
  } })
  return { complete(input) { reserve(); return model.complete(observe(input)) }, stream(input) { reserve(); return model.stream(observe(input)) } }
}
