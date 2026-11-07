import type { createBackend } from '../database/backend'
import type { FirstPartyRuntime } from '../mcp/first-party-client'
import type { StreamingAgentModel } from '../../shared/agent'
import { createAskAgentTasks } from './ask-agent-tasks'
import { randomUUID } from 'node:crypto'

/** Exercise native Pi ESM loading and real discovery/MCP from the distributed CJS entry, without a paid model. */
export async function verifyAskPackage(backend: ReturnType<typeof createBackend>, mcp: FirstPartyRuntime) {
  let step = 0
  const choice = { providerId: 'package-fixture', modelId: 'package-model' }
  const model: StreamingAgentModel = {
    complete: async () => { throw new Error('Unexpected automatic model task') },
    async *stream(input) {
      if (step === 0 && JSON.stringify(input.tools.map(t => t.name)) !== JSON.stringify(['tool.search', 'tool.activate'])) throw new Error('PACKAGE_ASK_INITIAL_TOOLS')
      if (step < 2) {
        const call = step++ === 0 ? { id: 'package-activation', name: 'tool.activate', arguments: { names: ['job.list'] } }
          : { id: 'package-jobs', name: 'job.list', arguments: {} }
        yield { type: 'tool_call.ready', call }; yield { type: 'completed', response: { content: '', toolCalls: [call] } }
      } else {
        const last = input.messages.at(-1)
        if (last?.role !== 'tool' || !Number.isInteger((JSON.parse(last.content) as { total: number }).total)) throw new Error('PACKAGE_ASK_MCP_RESULT')
        yield { type: 'content.delta', text: 'Runtime verified.' }
        yield { type: 'completed', response: { content: 'Runtime verified.', toolCalls: [] } }
      }
    }
  }
  const tasks = createAskAgentTasks({ chats: backend.chats, mcp, model: () => model,
    capabilities: async () => ({ contextWindow: 65536, maxOutputTokens: 8192, source: 'manual', verified: true }) })
  const result = tasks.start(1, { requestId: randomUUID(), choice, message: 'Verify the installed Ask runtime.' }, () => {})
  try {
    const end = Date.now() + 15000
    while (tasks.getRun(1, { runId: result.runId }).run.state === 'running' && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20))
    const snapshot = tasks.getRun(1, { runId: result.runId })
    if (snapshot.run.state !== 'completed' || step !== 2) throw new Error('PACKAGE_ASK_RUNTIME_FAILED')
  } finally { await tasks.dispose(); backend.chats.deleteSession(result.sessionId) }
}
