import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { firstPartyFixture } from './first-party-fixture'
import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import type { AgentModelEvent, AgentToolCall, StreamingAgentModel } from '../src/shared/agent'
const batch = (call: AgentToolCall): AgentModelEvent[] => [{ type: 'tool_call.ready', call }, { type: 'completed', response: { content: '', toolCalls: [call] } }]
const answer = (text: string): AgentModelEvent[] => [{ type: 'content.delta', text }, { type: 'completed', response: { content: text, toolCalls: [] } }]
const input = (message: string) => ({ message, requestId: randomUUID(), choice: { providerId: 'fixture', modelId: 'manual-memory' } })
async function wait(tasks: ReturnType<typeof createAskAgentTasks>, runId: string) {
  for (let n = 0; n < 500; n++) { const value = tasks.getRun(1, { runId }); if (value.run.state !== 'running') return value; await new Promise(r => setTimeout(r, 10)) }
  throw new Error('Memory agent timeout')
}
test('deterministic Ask AI fixture saves only after explicit request and recalls across new sessions without storing Memory bodies in activity', async t => {
  const f = await firstPartyFixture(t)
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream(request) {
    const system = request.messages[0].content
    assert(system.includes('explicit user request')); assert(system.includes('never prefetch all Memory')); assert(system.includes('not a per-turn server permission'))
    const user = [...request.messages].reverse().find(x => x.role === 'user')!.content
    const previous = request.messages.at(-1)!
    if (previous.role === 'tool') {
      const result = JSON.parse(previous.content); assert(!result.error)
      if (user === 'What editor do I prefer?') { assert(result.text.includes('PRIVATE_MEMORY_BODY VS Code')); yield* answer('You prefer VS Code.'); return }
      yield* answer('Remembered.'); return
    }
    if (user === 'Please remember my editor preference.') yield* batch({ id: 'save', name: 'memory.write', arguments: { path: 'preferences.md', content: 'PRIVATE_MEMORY_BODY VS Code', expectedRevision: null } })
    else if (user === 'What editor do I prefer?') yield* batch({ id: 'recall', name: 'memory.recall', arguments: { query: 'editor VS Code' } })
    else yield* answer('Hello.')
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const normal = tasks.start(1, input('Hello'), () => {}), normalResult = await wait(tasks, normal.runId)
  assert(!normalResult.run.writeStarted)
  assert.equal((await f.workspace.spaces.memory.files.tree()).children?.length, 1)
  const saved = tasks.start(1, input('Please remember my editor preference.'), () => {}), savedResult = await wait(tasks, saved.runId)
  assert.equal(savedResult.run.state, 'completed'); assert(savedResult.run.writeStarted)
  assert(!JSON.stringify(savedResult).includes('PRIVATE_MEMORY_BODY'))
  const recalled = tasks.start(1, input('What editor do I prefer?'), () => {}), recalledResult = await wait(tasks, recalled.runId)
  assert.notEqual(saved.sessionId, recalled.sessionId); assert.equal(recalledResult.run.state, 'completed'); assert(!recalledResult.run.writeStarted)
  assert(recalledResult.items.some(x => x.content.type === 'tool_call' && x.content.display.key === 'memoryRead'))
  assert(savedResult.items.some(x => x.content.type === 'tool_call' && x.content.display.key === 'memoryWrite'))
  assert(!JSON.stringify(recalledResult).includes('PRIVATE_MEMORY_BODY'))
})
test('manual Memory update rereads after conflict, preserves unrelated content and never blindly repeats a stale write', async t => {
  const f = await firstPartyFixture(t)
  await f.workspace.spaces.memory.files.write('preferences.md', 'keep unrelated\neditor: old', null)
  let step = 0, revision = ''
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream(request) {
    const previous = request.messages.at(-1)!
    if (previous.role === 'tool') {
      const result = JSON.parse(previous.content)
      if (step === 2) assert.equal(result.error, 'TOOL_CONFLICT')
      else { assert(!result.error); revision = result.revision }
      if (step === 1) await f.workspace.spaces.memory.files.write('preferences.md', 'keep unrelated\nconcurrent preference\neditor: old', revision)
      if (step === 3) assert(result.content.includes('concurrent preference'))
    }
    const calls: [string, Record<string, unknown>][] = [
      ['memory.read', { path: 'preferences.md' }], ['memory.write', { path: 'preferences.md', content: 'keep unrelated\neditor: new', expectedRevision: revision }],
      ['memory.read', { path: 'preferences.md' }], ['memory.write', { path: 'preferences.md', content: 'keep unrelated\nconcurrent preference\neditor: new', expectedRevision: revision }]
    ]
    if (step === calls.length) { yield* answer('Updated.'); return }
    const [name, args] = calls[step++]; yield* batch({ id: `conflict-${step}`, name, arguments: args })
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const result = await wait(tasks, tasks.start(1, input('Please remember my new editor.'), () => {}).runId)
  assert.equal(result.run.state, 'completed'); assert.equal(step, 4)
  assert.equal((await f.workspace.spaces.memory.files.read('preferences.md')).content, 'keep unrelated\nconcurrent preference\neditor: new')
})
test('uncertain Memory write stops the agent and retains an uncertain activity without copying its body', async t => {
  const f = await firstPartyFixture(t); f.flag('fail-audit-finish')
  let calls = 0
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream() {
    calls++; yield* batch({ id: 'uncertain-memory', name: 'memory.write', arguments: { path: 'uncertain.md', content: 'PRIVATE_UNCERTAIN_MEMORY', expectedRevision: null } })
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const result = await wait(tasks, tasks.start(1, input('Please remember this.'), () => {}).runId)
  assert.equal(calls, 1); assert.equal(result.run.error, 'TOOL_AUDIT_UNAVAILABLE'); assert(result.run.writeStarted)
  assert(result.items.some(x => x.state === 'uncertain')); assert(!JSON.stringify(result).includes('PRIVATE_UNCERTAIN_MEMORY'))
  assert.equal((await f.workspace.spaces.memory.files.read('uncertain.md')).content, 'PRIVATE_UNCERTAIN_MEMORY')
})

test('Stop during a Memory tool call retains the write attempt and uncertain-result activity without retry', async t => {
  const f = await firstPartyFixture(t); let calls = 0
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream() {
    calls++; yield* batch({ id: 'stop-memory', name: 'memory.write', arguments: { path: 'stopped.md', content: 'PRIVATE_STOPPED_MEMORY', expectedRevision: null } })
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const started = tasks.start(1, input('Please remember this.'), event => {
    if (event.type === 'item.started' && event.item.content.type === 'tool_call') tasks.cancel(1, { runId: event.runId })
  })
  const result = await wait(tasks, started.runId)
  assert.equal(result.run.state, 'cancelled'); assert(result.run.writeStarted); assert.equal(calls, 1)
  assert(result.items.some(item => item.state === 'uncertain')); assert(!JSON.stringify(result).includes('PRIVATE_STOPPED_MEMORY'))
})
