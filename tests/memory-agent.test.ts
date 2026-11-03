import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { firstPartyFixture } from './first-party-fixture'
import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import type { AgentModelInput, StreamingAgentModel } from '../src/shared/agent'
import { fixtureCapabilities } from './ask-fixture'
import { ContextBudget } from '../src/platform/agent/context/budget'
import { MemoryManager } from '../src/platform/agent/memory/manager'
import type { MemoryProgress } from '../src/shared/ask'
const choice = { providerId: 'fixture', modelId: 'memory-model' }
const input = (message: string, sessionId?: string) => ({ message, sessionId, requestId: randomUUID(), choice })
async function wait(tasks: ReturnType<typeof createAskAgentTasks>, runId: string) {
  for (let n = 0; n < 800; n++) { const value = tasks.getRun(1, { runId }); if (value.run.state !== 'running' && value.run.runtimeStatus !== 'memory.updating') return value; await new Promise(r => setTimeout(r, 10)) }
  throw new Error('Memory task timeout')
}
function automaticModel(before?: (request: AgentModelInput) => Promise<void>): StreamingAgentModel {
  return { async complete(request) {
    await before?.(request)
    const data = JSON.parse(request.messages[1].content) as Record<string, unknown>
    if (request.messages[0].content.startsWith('Select the existing')) return { content: JSON.stringify({ targetPath: data.defaultPath }), toolCalls: [] }
    if (request.messages[0].content.startsWith('Extract durable')) return { content: JSON.stringify({ candidates: String(data.userMessage).includes('prefer') ? [{ category: 'preference', content: data.userMessage, quote: data.userMessage, sourceMessageIds: [data.sourceMessageId], importance: 0.9 }] : [] }), toolCalls: [] }
    const candidates = data.candidates as { content: string }[] | undefined
    const value = candidates?.map(c => c.content).join('\n') ?? String(data.pendingUpdate ?? '')
    return { content: JSON.stringify({ content: `${data.existing || '# Preferences'}\n${value}` }), toolCalls: [] }
  }, async *stream(request) {
    assert(!request.tools.some(t => ['memory.write', 'memory.mkdir', 'knowledge.delete'].includes(t.name)))
    const text = 'Answer'; yield { type: 'content.delta', text }; yield { type: 'completed', response: { content: text, toolCalls: [] } }
  } }
}
function tasksFor(f: Awaited<ReturnType<typeof firstPartyFixture>>, model: StreamingAgentModel, parallel = false) {
  return createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model, capabilities: async () => fixtureCapabilities,
    settings: () => ({ providers: [{ id: 'fixture', name: 'Fixture', baseURL: 'http://localhost', requiresKey: false, models: [choice.modelId], defaultModel: choice.modelId, parallelModels: parallel ? [choice.modelId] : [] }], default: choice }) })
}
test('automatic Memory uses source-bound MCP writes; ordinary chat is no_change; Core and L2 are visible in later sessions', async t => {
  const f = await firstPartyFixture(t), model = automaticModel(), tasks = tasksFor(f, model); t.after(() => tasks.dispose())
  const normal = tasks.start(1, input('Hello'), () => {}); assert.equal((await wait(tasks, normal.runId)).run.state, 'completed')
  assert.equal(f.backend.chats.memoryProgress(normal.sessionId)[0].phase, 'no_change')
  const saved = tasks.start(1, input('I prefer VS Code for editing.'), () => {}), result = await wait(tasks, saved.runId)
  assert.equal(result.run.state, 'completed', result.run.error ?? '')
  assert.equal(f.backend.chats.memoryProgress(saved.sessionId)[0].phase, 'committed')
  for (const path of ['preferences.md', 'CORE.md']) assert((await f.workspace.spaces.memory.files.read(path)).content.includes('VS Code'))
  assert(!JSON.stringify(result.items.filter(item => item.content.type === 'tool_call')).includes('VS Code'))
  let captured = ''
  const reader = tasksFor(f, { ...automaticModel(), async *stream(request) { captured = JSON.stringify(request.messages); yield { type: 'content.delta', text: 'Hello' }; yield { type: 'completed', response: { content: 'Hello', toolCalls: [] } } } }); t.after(() => reader.dispose())
  const recalled = reader.start(1, input('What editor do I use?'), () => {}); assert.equal((await wait(reader, recalled.runId)).run.state, 'completed'); assert(captured.includes('VS Code'))
})
test('parallel Memory freezes the current snapshot and blocks admission of the next turn until commit', async t => {
  const f = await firstPartyFixture(t)
  let release!: () => void, entered = false, streams = 0
  const block = new Promise<void>(r => { release = r })
  const model = automaticModel(async request => { if (request.messages[0].content.startsWith('Extract durable') && !entered) { entered = true; await block } })
  const original = model.stream
  model.stream = async function* (request) { streams++; yield* original(request) }
  const tasks = tasksFor(f, model, true); t.after(() => tasks.dispose())
  const first = tasks.start(1, input('I prefer VS Code.'), () => {})
  for (let n = 0; n < 500 && (!entered || streams < 1); n++) await new Promise(r => setTimeout(r, 10))
  assert(entered); assert.equal(streams, 1)
  const next = tasks.start(1, input('Next question', first.sessionId), () => {})
  assert.equal(tasks.getRun(1, { runId: next.runId }).run.admission, 'pending')
  await new Promise(r => setTimeout(r, 30)); assert.equal(streams, 1)
  release(); assert.equal((await wait(tasks, next.runId)).run.state, 'completed'); assert.equal(streams, 2)
})
test('blocking mode finishes Memory before Pi; Stop cancels memory and a new input recovers it without replaying the old run', async t => {
  const f = await firstPartyFixture(t)
  let entered = false, streams = 0, first = true
  const model = automaticModel(async request => {
    if (first && request.messages[0].content.startsWith('Extract durable')) {
      first = false; entered = true
      await new Promise<void>(r => { request.signal.addEventListener('abort', () => r(), { once: true }) }); request.signal.throwIfAborted()
    }
  })
  const original = model.stream; model.stream = async function* (request) { streams++; yield* original(request) }
  const tasks = tasksFor(f, model); t.after(() => tasks.dispose())
  const old = tasks.start(1, input('I prefer VS Code.'), () => {})
  for (let n = 0; n < 500 && !entered; n++) await new Promise(r => setTimeout(r, 10))
  assert(entered); assert.equal(streams, 0); tasks.cancel(1, { runId: old.runId })
  assert.equal((await wait(tasks, old.runId)).run.state, 'cancelled')
  const next = tasks.start(1, input('Continue with a new question', old.sessionId), () => {})
  assert.notEqual(next.runId, old.runId); assert.equal((await wait(tasks, next.runId)).run.state, 'completed')
  assert.equal(streams, 1); assert.equal(f.backend.chats.getRun(old.runId).state, 'cancelled')
  assert.equal(f.backend.chats.memoryProgress(old.sessionId)[0].phase, 'committed')
})

test('persistent Memory failure retains queued input until Memory-only retry releases the barrier', async t => {
  const f = await firstPartyFixture(t)
  let failing = true, streams = 0
  const model = automaticModel(async request => { if (failing && request.messages[0].content.startsWith('Extract durable')) throw new Error('offline') })
  const original = model.stream; model.stream = async function* (request) { streams++; yield* original(request) }
  const tasks = tasksFor(f, model); t.after(() => tasks.dispose())
  const first = tasks.start(1, input('I prefer VS Code.'), () => {})
  for (let n = 0; n < 500 && tasks.getRun(1, { runId: first.runId }).run.runtimeStatus !== 'memory.failed'; n++) await new Promise(r => setTimeout(r, 10))
  assert.equal(tasks.getRun(1, { runId: first.runId }).run.state, 'running'); assert.equal(streams, 0)
  const second = tasks.start(1, input('Follow-up', first.sessionId), () => {})
  assert.equal(tasks.getRun(1, { runId: second.runId }).run.admission, 'pending')
  await assert.rejects(tasks.retryMemory(1, { runId: first.runId }), /offline/)
  assert.equal(tasks.getRun(1, { runId: second.runId }).run.state, 'running')
  failing = false; await tasks.retryMemory(1, { runId: first.runId })
  assert.equal((await wait(tasks, second.runId)).run.state, 'completed'); assert.equal(streams, 2)
  assert.equal(f.backend.chats.listItems(first.sessionId, 100).items.filter(i => i.content.type === 'user_message').length, 2)
})

for (const fault of ['lost-core-response', 'checkpoint-failure']) test(`Memory recovery reconciles ${fault} without repeating committed files`, async t => {
  const f = await firstPartyFixture(t), saved = f.backend.chats.start(input('I prefer VS Code.'))
  const user = f.backend.chats.snapshot(saved.runId).items[0], signal = new AbortController().signal
  const tools = await f.mcp.session('ask-memory', signal, saved.sessionId, [user.id])
  let progress: MemoryProgress = { messageId: user.id, sequence: user.sequence, phase: 'pending', writes: [], nextWrite: 0, error: null }
  let inject = true
  const counts = new Map<string, number>()
  const wrapped = { list: () => tools.list(), async call(name: string, args: unknown, abort: AbortSignal) {
    const result = await tools.call(name, args, abort)
    if (name === 'memory.write') {
      const { path } = args as { path: string }; counts.set(path, (counts.get(path) ?? 0) + 1)
      if (inject && fault === 'lost-core-response' && path === 'CORE.md') { inject = false; throw new Error('response lost after commit') }
    }
    return result
  } }
  const make = () => new MemoryManager({ model: automaticModel(), tools: wrapped, budget: new ContextBudget(fixtureCapabilities, 'fixture'), source: { id: user.id, text: 'I prefer VS Code.' }, progress: structuredClone(progress),
    save(value) {
      if (inject && fault === 'checkpoint-failure' && value.phase === 'committed') { inject = false; throw new Error('checkpoint failed') }
      progress = structuredClone(value); f.backend.chats.saveMemory(saved.sessionId, value)
    }, commit: operation => operation() })
  await assert.rejects(make().run(signal)); assert.equal(progress.phase, 'failed'); assert(progress.writes.length > 0)
  await make().run(signal); assert.equal(progress.phase, 'committed')
  assert.equal(counts.get('preferences.md'), 1); assert.equal(counts.get('CORE.md'), 1)
  assert.equal(progress.writes.length, 0)
})

test('concurrent Sessions reconcile shared L2 and Core revisions instead of losing another user decision', async t => {
  const f = await firstPartyFixture(t), tasks = tasksFor(f, automaticModel(), true); t.after(() => tasks.dispose())
  const a = tasks.start(1, input('I prefer VS Code.'), () => {}), b = tasks.start(1, input('I prefer concise answers.'), () => {})
  await Promise.all([wait(tasks, a.runId), wait(tasks, b.runId)])
  for (const [runId, sessionId] of [[a.runId, a.sessionId], [b.runId, b.sessionId]]) assert.equal(tasks.getRun(1, { runId }).run.runtimeStatus, 'idle', JSON.stringify(f.backend.chats.memoryProgress(sessionId).map(p => ({ phase: p.phase, error: p.error }))))
  for (const path of ['preferences.md', 'CORE.md']) {
    const file = await f.workspace.spaces.memory.files.read(path)
    assert(file.content.includes('VS Code')); assert(file.content.includes('concise answers'))
  }
})
