import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import type { AgentModelEvent, StreamingAgentModel } from '../src/shared/agent'

export const fixtureCapabilities = { contextWindow: 262144, maxOutputTokens: 8192, source: 'manual' as const, verified: true }
/** Existing business scenarios now model activation explicitly while retaining their business scripts. */
export function discoveringModel(model: StreamingAgentModel): StreamingAgentModel {
  let pending: AgentModelEvent[] | undefined, serial = 0
  return { complete: input => model.complete(input), async *stream(input) {
    if (pending) { yield* pending; pending = undefined; return }
    const businessInput = { ...input, messages: input.messages.filter(m => !(m.role === 'assistant' && m.toolCalls.some(c => c.name.startsWith('tool.')))
      && !(m.role === 'tool' && m.callId.startsWith('discover-'))) }
    const buffered: AgentModelEvent[] = []
    for await (const event of model.stream(businessInput)) {
      if (event.type === 'content.delta' || event.type === 'reasoning.delta') yield event
      else buffered.push(event)
    }
    const response = buffered.find(e => e.type === 'completed')
    const missing = response?.type === 'completed' ? response.response.toolCalls.filter(c => !input.tools.some(t => t.name === c.name)).map(c => c.name) : []
    if (!missing.length) { yield* buffered; return }
    const content = response?.type === 'completed' ? response.response.content : ''
    pending = buffered
    const call = { id: `discover-${++serial}`, name: 'tool.activate', arguments: { names: [...new Set(missing)] } }
    yield { type: 'tool_call.ready', call }; yield { type: 'completed', response: { content, toolCalls: [call] } }
  } }
}
export function createFixtureAskTasks(deps: Pick<Parameters<typeof createAskAgentTasks>[0], 'chats' | 'mcp' | 'model'>) {
  return createAskAgentTasks({ ...deps, model: choice => discoveringModel(deps.model(choice)), capabilities: async () => fixtureCapabilities })
}
