import { AgentError, abortable, type AgentPhase, type AgentRuntimeEvent, type AgentTools, type StreamingAgentModel } from '../../../shared/agent'
import type { AskRuntimeStatus } from '../../../shared/ask'
import type { ContextBudget } from '../context/budget'
import { loadCoreMemory } from '../context/core-memory'
import { ContextManager } from '../context/manager'
import { resourceRecord } from '../context/resources'
import { observeAgentModel } from '../pi/request-observer'
import { runPiAgent, type RunProgress } from '../pi/runtime'
import { ScopedToolset } from '../tools/scoped-toolset'

type History = Pick<ConstructorParameters<typeof ContextManager>[0], 'checkpoint' | 'turns' | 'save'>
export type RunHistory = History & { protectedState: string[] }

export function createRunExecution(deps: {
  model: StreamingAgentModel; budget: ContextBudget; tools: AgentTools; signal: AbortSignal; userSignal: AbortSignal
  maxModelRequests: number; maxToolCalls: number; protectedState: string[]
  emit(event: AgentRuntimeEvent): void; status(value: AskRuntimeStatus): void; protect?(record: string): void; onToolTurn?(): void
}) {
  const progress: RunProgress = { cycleIndex: 0, itemSerial: 0, toolCalls: 0 }
  const modelProgress = { ordinal: 0, requests: 0 }
  const protectedState = { records: deps.protectedState }
  return {
    loadCore(tools: AgentTools) {
      if (++progress.toolCalls > deps.maxToolCalls) throw new AgentError('AGENT_STEP_LIMIT')
      return abortable(loadCoreMemory(tools, deps.budget, deps.signal), deps.signal)
    },
    get cycleIndex() { return progress.cycleIndex },
    async stage(input: {
      phase: AgentPhase; system: string; message: string; tools?: AgentTools; allow: readonly string[]
      memory?: string; history?: History; status: AskRuntimeStatus
    }) {
      const tools = input.tools ?? deps.tools
      const model = observeAgentModel(deps.model, deps.emit, deps.maxModelRequests, modelProgress, input.phase)
      const context = new ContextManager({ ...input.history, protectedState, budget: deps.budget, model, memory: input.memory ?? '',
        compacting: () => deps.status('context.compacting') })
      const toolset = new ScopedToolset(tools, deps.budget, name => input.allow.includes(name))
      deps.status(input.status)
      return runPiAgent({ ...deps, model, tools, toolset, context, system: input.system, message: input.message, progress,
        phase: input.phase, activeStatus: input.status, onToolTurn: input.phase === 'execute' ? deps.onToolTurn : undefined,
        protect(name, args, result, uncertain) {
          const record = resourceRecord(name, args, result, uncertain)
          if (record) { deps.protect?.(record); context.protect(record) }
        }
      })
    }
  }
}
export type RunExecution = ReturnType<typeof createRunExecution>
