import { toolSnapshot } from '../src/platform/ai/agent-request'
import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import type { AgentModelEvent, StreamingAgentModel } from '../src/shared/agent'

export const fixtureCapabilities = { contextWindow: 262144, maxOutputTokens: 8192, source: 'manual' as const }
/** Existing business scenarios model Scope expansion explicitly while retaining their business scripts. */
export function discoveringModel(model: StreamingAgentModel): StreamingAgentModel {
  let pending: AgentModelEvent[] | undefined, serial = 0
  return { complete: input => model.complete(input), async *stream(input) {
    if (pending) { yield* pending; pending = undefined; return }
    const businessInput = { ...input, messages: input.messages.filter(m => !(m.role === 'assistant' && m.toolCalls.some(c => c.name.startsWith('scope.')))
      && !(m.role === 'tool' && m.callId.startsWith('discover-'))) }
    const buffered: AgentModelEvent[] = []
    for await (const event of model.stream(businessInput)) {
      if (event.type === 'content.delta' || event.type === 'reasoning.delta') yield event
      else buffered.push(event)
    }
    const response = buffered.find(e => e.type === 'completed')
    const missing = response?.type === 'completed' ? response.response.toolCalls.filter(c => !input.tools.some(t => t.name === c.name)).map(c => c.name) : []
    if (!missing.length || missing.some(name => !input.tools.some(tool => tool.name === `scope.${name.split('.')[0]}`))) { yield* buffered; return }
    const content = response?.type === 'completed' ? response.response.content : ''
    pending = buffered
    const calls = [...new Set(missing.map(name => `scope.${name.split('.')[0]}`))].map(name => ({ id: `discover-${++serial}`, name, arguments: {} }))
    for (const call of calls) yield { type: 'tool_call.ready', call }
    yield { type: 'completed', response: { content, toolCalls: calls } }
  } }
}
export function withPreparation(model: StreamingAgentModel): StreamingAgentModel {
  return { complete: input => model.complete(input), async *stream(input) {
    if (!input.messages[0].content.startsWith('Prepare a self-contained handoff')) { yield* model.stream(input); return }
    input.onRequestPrepared?.({ providerId: 'fixture', modelId: 'test', preparedAt: 'fixture', tools: toolSnapshot(input.tools) })
    const content = JSON.stringify({ status: 'ready', prompt: 'Use the original request.' })
    yield { type: 'content.delta', text: content }
    yield { type: 'completed', response: { content, toolCalls: [] } }
  } }
}
export function createFixtureAskTasks(deps: Pick<Parameters<typeof createAskAgentTasks>[0], 'chats' | 'mcp' | 'model'>, discover = true) {
  return createAskAgentTasks({ ...deps, model: choice => {
    const model = deps.model(choice)
    return withPreparation(discover ? discoveringModel(model) : model)
  }, capabilities: async () => fixtureCapabilities })
}
