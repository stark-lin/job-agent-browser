import { AgentError, abortable, type AgentRuntimeEvent, type AgentTools } from '../../../shared/agent'
import { askReadTools } from '../../../shared/agent/ask-policy'
import type { AskRuntimeStatus } from '../../../shared/ask'
import { parsePreparation } from '../prepare'
import { getExecutePrompt, getPreparePrompt } from '../prompts'
import type { AgentInvocation } from './definitions'
import type { RunExecution, RunHistory } from './execution-context'

export async function runAskWorkflow(deps: {
  run: RunExecution; invocation: Extract<AgentInvocation, { agent: 'ask' }>
  tools: AgentTools; allow: readonly string[]; signal: AbortSignal; history?: RunHistory
  emit(event: AgentRuntimeEvent): void; status(value: AskRuntimeStatus): void
}): Promise<string> {
  const { invocation, run, tools, signal } = deps
  const { language, source } = invocation
  const original = invocation.message.trim()
  deps.status('preparing')
  if (!tools.view) throw new AgentError('AGENT_PROTOCOL_ERROR')
  const catalog = await abortable(tools.list(), signal)
  const prepareAllow = askReadTools(catalog, deps.allow)
  const prepareTools = tools.view(prepareAllow)
  const memory = prepareAllow.includes('memory.read') ? await run.loadCore(prepareTools) : ''
  const text = await run.stage({ phase: 'prepare', system: getPreparePrompt(language, source), message: original, tools: prepareTools, allow: prepareAllow,
    status: 'preparing', memory, history: deps.history })
  signal.throwIfAborted()
  const result = parsePreparation(text)
  deps.emit({ type: 'preparation.completed', phase: 'prepare', result, cycleIndex: run.cycleIndex, finishedAt: new Date().toISOString() })
  if (result.status === 'blocked') return result.reason

  const executeAllow = source === 'smart-paste' ? prepareAllow : deps.allow
  const executeTools = tools.view(executeAllow)
  return run.stage({ phase: 'execute', tools: executeTools, allow: executeAllow, status: 'executing',
    system: getExecutePrompt(language, source), message: `Original Request:\n${original}\n\nPrepared Task:\n${result.prompt}` })
}
