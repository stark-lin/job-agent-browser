import type { AgentTool } from '@earendil-works/pi-agent-core' with { 'resolution-mode': 'import' }
import { AgentError, abortable, isAgentCancellation, type AgentRuntimeEvent, type AgentToolDescriptor, type AgentTools, type StreamingAgentModel } from '../../../shared/agent'
import type { CycleStatus, SettledCycleStatus } from '../../../shared/agent/react-cycle'
import { guardNextAction, type RunGuardSnapshot } from '../../../shared/agent/run-guard'
import { ToolError } from '../../../shared/tools/errors'
import type { AskRuntimeStatus } from '../../../shared/ask'
import type { ContextBudget } from '../context/budget'
import type { ContextManager } from '../context/manager'
import { nextAction, resolveCycle, settleCycle, startCycle } from '../react-cycle/machine'
import { modelToolResult } from '../../../shared/agent/tool-result'
import { isAskWrite } from '../tool-presentation'
import { ToolDiscovery } from '../tools/discovery'
import { createPiStream, piReasoning } from './model-adapter'

export async function runPiAsk(deps: {
  model: StreamingAgentModel; tools: AgentTools; system: string; message: string; signal: AbortSignal; userSignal?: AbortSignal
  budget: ContextBudget; context: ContextManager; emit(event: AgentRuntimeEvent): void
  status(value: AskRuntimeStatus): void; protect(name: string, args: unknown, result: unknown, uncertain: boolean): void
}) {
  const { Agent } = await import('@earendil-works/pi-agent-core')
  const userSignal = deps.userSignal ?? deps.signal
  let failure: unknown, serial = 0, recoverBatch = false, index = 0
  let cycle: CycleStatus | null = null, outcome: SettledCycleStatus | undefined, guard: RunGuardSnapshot | undefined
  let action: ReturnType<typeof nextAction> = 'CONTINUE'
  const guidance = (snapshot?: RunGuardSnapshot) => snapshot?.level ? [{ type: 'text' as const,
    text: `\nRunGuard guidance: ${JSON.stringify({ level: snapshot.level, nextAction: snapshot.nextAction })}` }] : []
  function failed(error: unknown) { failure ??= error }
  function observeFailure(error: unknown) { if (!isAgentCancellation(error, userSignal)) failed(error) }
  function activeCycle() {
    if (failure) throw failure
    deps.signal.throwIfAborted()
    if (cycle !== 'RUNNING' || outcome) throw new AgentError('AGENT_PROTOCOL_ERROR')
    return index
  }
  const registry = new ToolDiscovery(deps.tools, deps.budget, activation => {
    try { deps.emit({ type: 'model.request.activation', activation }) }
    catch (error) { failed(error); throw error }
  })
  await abortable(registry.refresh(), deps.signal)
  function observeGuard(name: string) {
    const snapshot = name.startsWith('tool.') ? undefined : deps.tools.getRunGuardSnapshot?.()
    if (snapshot) {
      guard = snapshot
      if (snapshot.level === 'recovery') recoverBatch = true
    }
    return snapshot
  }
  const tool = (descriptor: AgentToolDescriptor): AgentTool => ({ name: descriptor.name, label: descriptor.name, description: descriptor.description, parameters: descriptor.inputSchema,
    async execute(callId, args, signal) {
      const name = descriptor.name, id = `tool-${++serial}`, began = Date.now()
      const combined = signal ? AbortSignal.any([signal, deps.signal]) : deps.signal
      try {
        activeCycle(); combined.throwIfAborted()
        if (recoverBatch) throw new AgentError('AGENT_PROTOCOL_ERROR')
        deps.emit({ type: 'tool.started', id, call: { id: callId, name, arguments: args } })
        if (name === 'tool.search') deps.status('tools.searching')
        if (name === 'tool.activate') deps.status('tools.activating')
        let result: unknown
        try { result = await abortable(registry.call(name, args, combined), combined) }
        catch (error) {
          const code = error instanceof ToolError || error instanceof AgentError ? error.code : 'TOOL_EXECUTION_FAILED'
          const snapshot = observeGuard(name)
          const rejected = code.startsWith('TOOL_GUARD_') && snapshot?.executed === false
          const uncertain = !rejected && isAskWrite(name) && !['TOOL_CONFLICT', 'TOOL_INVALID_INPUT', 'TOOL_FORBIDDEN', 'TOOL_NOT_FOUND', 'TOOL_BUSY'].includes(code)
          const blocked = snapshot?.status === 'BLOCKED' || code === 'TOOL_GUARD_TERMINATED'
          if (uncertain) failed(error)
          else if (blocked) failed(new ToolError('TOOL_GUARD_TERMINATED'))
          else if (combined.aborted || error instanceof AgentError || ['TOOL_CANCELLED', 'TOOL_AUDIT_UNAVAILABLE', 'MCP_DISCONNECTED', 'TOOL_UNAVAILABLE', 'MCP_INVALID_RESPONSE'].includes(code)) observeFailure(error)
          if (!rejected) deps.protect(name, args, null, uncertain)
          deps.emit({ type: 'tool.failed', id, name, error: code, durationMs: Date.now() - began, uncertain, guard: snapshot })
          return { content: [{ type: 'text', text: JSON.stringify({ error: code, ...(snapshot ? { reason: snapshot.reason, executed: snapshot.executed, effectAlreadyConfirmed: snapshot.effectAlreadyConfirmed } : {}) }) }, ...guidance(snapshot)], details: {}, isError: true }
        }
        const snapshot = observeGuard(name)
        if (snapshot?.status === 'BLOCKED') failed(new ToolError('TOOL_GUARD_TERMINATED'))
        deps.emit({ type: 'tool.completed', id, name, result, durationMs: Date.now() - began, guard: snapshot })
        deps.protect(name, args, result, false)
        return { content: [{ type: 'text', text: JSON.stringify(modelToolResult(name, result)) }, ...guidance(snapshot)], details: {} }
      } catch (error) {
        observeFailure(error)
        throw error
      }
    } })
  const streamFn = await createPiStream({ model: deps.model, budget: deps.budget, signal: deps.signal, cycleIndex: activeCycle, prepare: async (m, t, s) => {
    const messages = await deps.context.prepare(m, t, s)
    s.throwIfAborted(); activeCycle(); deps.status('idle')
    // Apply the previous settlement after compaction so it cannot remove trusted guidance.
    const level = action === 'RECOVER' ? 'recovery' : action === 'CONTINUE_WITH_WARNING' ? 'warning' : undefined
    return level ? messages.map(message => message.role === 'system'
      ? { ...message, content: `${message.content}\nRuntime RunGuard ${level}: ${guardNextAction}` } : message) : messages
  }, failed: observeFailure,
    loadout: () => registry.snapshot(), advertised: names => registry.confirmRequest(names),
    completed: response => deps.emit({ type: 'model.completed', response, cycleIndex: activeCycle() }) })
  const agent = new Agent({ streamFn, toolExecution: 'sequential', initialState: {
    systemPrompt: deps.system, tools: registry.loadout().map(tool), thinkingLevel: 'off',
    model: { id: 'jab-model', name: 'JAB model', api: 'openai-completions', provider: 'jab', baseUrl: '', input: ['text'], reasoning: false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: deps.budget.capabilities.contextWindow, maxTokens: deps.budget.output }
  }, finishTurn: ({ message }) => {
    if (cycle !== 'RUNNING') return { action: 'end' }
    const cancelled = userSignal.aborted
    if (deps.signal.aborted && !cancelled) failed(deps.signal.reason)
    if (message.stopReason === 'error' && !cancelled) failed(new AgentError('AI_PROVIDER_FAILED'))
    if (message.stopReason === 'aborted' && !cancelled) failed(new AgentError('AI_PROVIDER_FAILED'))
    outcome = resolveCycle({ fatal: Boolean(failure), cancelled, finalAnswer: message.stopReason === 'stop', guard })
    return nextAction(outcome) === 'STOP' ? { action: 'end' } : undefined
  }, prepareNextTurnWithContext: async ({ context }) => {
    try {
      if (nextAction(cycle) === 'STOP' || failure) throw failure ?? new AgentError('AGENT_PROTOCOL_ERROR')
      deps.signal.throwIfAborted()
      await abortable(registry.refresh(), deps.signal)
      deps.signal.throwIfAborted()
      const tools = registry.loadout().map(tool); agent.state.tools = tools
      return { context: { ...context, tools } }
    } catch (error) { observeFailure(error); throw error }
  }, beforeToolCall: async () => {
    if (failure || deps.signal.aborted || cycle !== 'RUNNING' || outcome) {
      if (!failure && !deps.signal.aborted) failed(new AgentError('AGENT_PROTOCOL_ERROR'))
      return { block: true, reason: 'Run stopped', terminate: true }
    }
    if (recoverBatch) return { block: true, reason: `Not executed: RunGuard requires a new decision. ${guardNextAction}` }
    return undefined
  } })
  let segment: string | undefined
  agent.subscribe(event => {
    try {
      if (event.type === 'turn_start') {
        deps.signal.throwIfAborted()
        if (failure) throw failure
        action = nextAction(cycle)
        const running = startCycle(cycle)
        deps.emit({ type: 'cycle.started', index: index + 1, startedAt: new Date().toISOString() })
        index++; cycle = running; recoverBatch = false; outcome = undefined
      } else if (event.type === 'turn_end' && cycle === 'RUNNING' && outcome) {
        const settled = settleCycle(cycle, outcome)
        if (settled === 'CONTINUE' || settled === 'WARNING' || settled === 'RECOVERING') {
          deps.emit({ type: 'cycle.settled', index, status: settled, reason: settled === 'CONTINUE' ? null : guard?.reason ?? 'NO_PROGRESS_LOOP', finishedAt: new Date().toISOString() })
        }
        cycle = settled
      } else if (event.type === 'message_update' && cycle === 'RUNNING' && !outcome && !failure && !deps.signal.aborted) {
        const update = event.assistantMessageEvent
        if (update.type === 'text_start' || update.type === 'thinking_start') {
          segment = `segment-${++serial}`; deps.emit({ type: 'segment.started', id: segment, kind: update.type === 'text_start' ? 'assistant_message' : 'reasoning',
            ...(update.type === 'thinking_start' ? { reasoning: piReasoning(update.partial.content[update.contentIndex]) } : {}) })
        }
        if ((update.type === 'text_delta' || update.type === 'thinking_delta') && segment) deps.emit({ type: 'segment.delta', id: segment, text: update.delta })
        if ((update.type === 'text_end' || update.type === 'thinking_end') && segment) { deps.emit({ type: 'segment.completed', id: segment }); segment = undefined }
      }
    } catch (error) { observeFailure(error); throw error }
  })
  const cancel = () => agent.abort()
  deps.signal.addEventListener('abort', cancel, { once: true })
  try {
    deps.signal.throwIfAborted()
    await agent.prompt(deps.message)
    if (failure) throw failure
    deps.signal.throwIfAborted()
    if (agent.state.errorMessage || cycle !== 'SUCCESS') throw new AgentError('AI_PROVIDER_FAILED')
  } finally { agent.abort(); await agent.waitForIdle(); deps.signal.removeEventListener('abort', cancel) }
}
