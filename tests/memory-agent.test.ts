import { chatDebugExportRepository } from '../src/platform/database/repositories/chat-debug-export'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { firstPartyFixture } from './first-party-fixture'
import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import { discoveringModel, fixtureCapabilities } from './ask-fixture'
import type { AgentModelEvent, AgentModelInput, StreamingAgentModel } from '../src/shared/agent'

const choice = { providerId: 'fixture', modelId: 'test' }, signal = new AbortController().signal
const start = (message: string, sessionId?: string) => ({ requestId: randomUUID(), message, sessionId, choice })
const gate = () => { let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve }); return { ready, release } }
async function until(check: () => boolean) {
  for (let n = 0; n < 1000; n++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.fail('Condition did not settle')
}
async function wait(tasks: ReturnType<typeof createAskAgentTasks>, runId: string) {
  await until(() => tasks.getRun(1, { runId }).run.state !== 'running')
  const snapshot = tasks.getRun(1, { runId }); assert.equal(snapshot.run.state, 'completed', snapshot.run.error ?? '')
  return snapshot
}
function answer(text = 'Done'): AgentModelEvent[] { return [{ type: 'content.delta', text }, { type: 'completed', response: { content: text, toolCalls: [] } }] }
function call(id: string, name: string, args: unknown): AgentModelEvent[] {
  const call = { id, name, arguments: args }; return [{ type: 'tool_call.ready', call }, { type: 'completed', response: { content: '', toolCalls: [call] } }]
}
function result(input: AgentModelInput): Record<string, string> {
  const last = input.messages.at(-1); assert.equal(last?.role, 'tool')
  // Runtime guidance follows the unchanged business JSON in a separate text block.
  return JSON.parse(last!.content.split('\nRunGuard guidance:')[0])
}
function setup(f: Awaited<ReturnType<typeof firstPartyFixture>>, model: () => StreamingAgentModel) {
  return createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model, capabilities: async () => fixtureCapabilities })
}
const noTask = async (): Promise<never> => { throw new Error('Unexpected automatic Memory model request') }

test('ordinary chat only loads Core, refreshes it every admitted turn, and never recalls L2 or creates progress', async t => {
  const f = await firstPartyFixture(t), core = f.workspace.spaces.memory.files
  const initial = await core.write('CORE.md', 'Core version one', null)
  let expected = 'Core version one', requests = 0
  const tasks = setup(f, () => ({ complete: noTask, async *stream(input) {
    requests++; assert(JSON.stringify(input.messages).includes(expected)); yield* answer()
  } })); t.after(() => tasks.dispose())
  const first = tasks.start(1, start('Hello'), () => {}); await wait(tasks, first.runId)
  await core.write('CORE.md', 'Core version two', initial.revision); expected = 'Core version two'
  const second = tasks.start(1, start('Hello again', first.sessionId), () => {}); await wait(tasks, second.runId)
  assert.equal(requests, 2)

  assert.equal(f.database.connection.prepare('SELECT count(*) n FROM chat_memory_progress').get()?.n, 0)
})

test('the sole Agent handles explicit and proactive Memory decisions through source-bound MCP writes', async t => {
  const f = await firstPartyFixture(t)
  let ordinal = 0
  const tasks = setup(f, () => {
    const file = `decision-${++ordinal}.md`; let step = 0
    return discoveringModel({ complete: noTask, async *stream(input) {
      if (step === 0) { step++; yield* call('read', 'memory.read', { path: file }); return }
      if (step === 1) { assert.equal(result(input).error, 'TOOL_NOT_FOUND'); step++; yield* call('write', 'memory.write', { path: file, content: 'Supported durable preference.', expectedRevision: null }); return }
      assert(result(input).revision); yield* answer('Memory saved.')
    } })
  }); t.after(() => tasks.dispose())
  const first = tasks.start(1, start('Remember that I prefer short answers.'), () => {}); await wait(tasks, first.runId)
  const second = tasks.start(1, start('My ongoing preference is plain English.', first.sessionId), () => {}); await wait(tasks, second.runId)
  for (const path of ['decision-1.md', 'decision-2.md']) assert.equal((await f.workspace.spaces.memory.files.read(path)).content, 'Supported durable preference.')
  const protectedState = f.backend.chats.protectedState(first.sessionId).join('\n')
  assert(protectedState.includes('decision-2.md')); assert(!protectedState.includes('Supported durable preference.'))
})

test('different Agent Sessions resolve a deterministic CAS conflict by rereading and merging outside the lock', async t => {
  const f = await firstPartyFixture(t), bothRead = gate()
  await f.workspace.spaces.memory.files.write('shared.md', 'Original decision', null)
  let readers = 0, conflicts = 0, ordinal = 0
  const tasks = setup(f, () => {
    const addition = `Decision ${++ordinal}`; let step = 0
    return discoveringModel({ complete: noTask, async *stream(input) {
      if (step === 0) { step++; yield* call('read', 'memory.read', { path: 'shared.md' }); return }
      if (step === 1) {
        const old = result(input); if (++readers === 2) bothRead.release(); await bothRead.ready
        step++; yield* call('write', 'memory.write', { path: 'shared.md', content: `${old.content}\n${addition}`, expectedRevision: old.revision }); return
      }
      if (step === 2 && result(input).error === 'TOOL_CONFLICT') { conflicts++; step++; yield* call('reread', 'memory.read', { path: 'shared.md' }); return }
      if (step === 3) { const old = result(input); step++; yield* call('merge', 'memory.write', { path: 'shared.md', content: `${old.content}\n${addition}`, expectedRevision: old.revision }); return }
      assert(result(input).revision); yield* answer()
    } })
  }); t.after(() => tasks.dispose())
  const a = tasks.start(1, start('Remember decision A'), () => {}), b = tasks.start(1, start('Remember decision B'), () => {})
  await Promise.all([wait(tasks, a.runId), wait(tasks, b.runId)])
  assert.equal(conflicts, 1)
  const saved = await f.workspace.spaces.memory.files.read('shared.md')
  for (const text of ['Original decision', 'Decision 1', 'Decision 2']) assert(saved.content.includes(text))
})

test('FIFO skips a cancelled queued turn without letting its successor overtake; capabilities wait too', async t => {
  const f = await firstPartyFixture(t), blocked = gate(), entered = gate(), order: string[] = []
  let capabilities = 0
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, capabilities: async () => { capabilities++; return fixtureCapabilities }, model: () => ({ complete: noTask, async *stream(input) {
    const current = input.messages.filter(m => m.role === 'user').at(-1)!.content; order.push(current)
    if (current === 'First') { entered.release(); await blocked.ready }
    yield* answer()
  } }) }); t.after(() => tasks.dispose())
  const first = tasks.start(1, start('First'), () => {}); await entered.ready
  const cancelled = tasks.start(1, start('Cancelled', first.sessionId), () => {})
  const last = tasks.start(1, start('Last', first.sessionId), () => {})
  tasks.cancel(1, { runId: cancelled.runId })
  await until(() => tasks.getRun(1, { runId: cancelled.runId }).run.state === 'cancelled')
  assert.equal(capabilities, 1); assert.deepEqual(order, ['First'])
  blocked.release(); await wait(tasks, last.runId)
  assert.deepEqual(order, ['First', 'Last']); assert.equal(capabilities, 2)
})

test('terminal persistence failure holds the next turn and retries records without rerunning models or tools', async t => {
  const f = await firstPartyFixture(t), entered = gate(), blocked = gate()
  let failing = true, requests = 0, attempts = 0
  const finish = f.backend.chats.finish.bind(f.backend.chats)
  f.backend.chats.finish = snapshot => { attempts++; if (failing) throw new Error('disk unavailable'); finish(snapshot) }
  const tasks = setup(f, () => ({ complete: noTask, async *stream() { requests++; if (requests === 1) { entered.release(); await blocked.ready }; yield* answer() } })); t.after(() => tasks.dispose())
  const first = tasks.start(1, start('First'), () => {}); await entered.ready
  const next = tasks.start(1, start('Next', first.sessionId), () => {}); blocked.release()
  await until(() => attempts >= 2)
  assert.equal(requests, 1); assert.equal(f.backend.chats.getRun(first.runId).state, 'running')
  failing = false; await wait(tasks, next.runId)
  assert.equal(requests, 2); assert.equal(f.backend.chats.getRun(first.runId).state, 'failed')
})

for (const failure of ['lost-response', 'stop'] as const) test(`Memory ${failure} retains uncertain state and never retries the write`, async t => {
  const f = await firstPartyFixture(t)
  let writes = 0, step = 0
  const open = f.mcp.openAgentRun.bind(f.mcp), blocked = gate(), entered = gate()
  f.mcp.openAgentRun = async (...args) => {
    const run = await open(...args), tools = run.tools, original = tools.call.bind(tools)
    tools.call = async (name, input, callSignal) => {
      if (name !== 'memory.write') return original(name, input, callSignal)
      writes++
      const output = await original(name, input, callSignal)
      if (failure === 'lost-response') throw new Error('Response lost after commit')
      if (failure === 'stop') { entered.release(); await blocked.ready }
      return output
    }
    return run
  }
  const tasks = setup(f, () => discoveringModel({ complete: noTask, async *stream() {
    if (!step++) { yield* call('write', 'memory.write', { path: 'uncertain.md', content: 'Committed once', expectedRevision: null }); return }
    assert.fail('An uncertain write must stop before another model inference')
  } })); t.after(() => tasks.dispose())
  const ids = tasks.start(1, start('Remember this'), () => {})
  if (failure === 'stop') { await entered.ready; tasks.cancel(1, { runId: ids.runId }); blocked.release() }
  await until(() => tasks.getRun(1, { runId: ids.runId }).run.state !== 'running')
  const snapshot = tasks.getRun(1, { runId: ids.runId })
  assert.equal(writes, 1); assert.equal(snapshot.run.state, 'failed')
  const run = chatDebugExportRepository(f.database.connection).getDebugBundle(ids.sessionId).runs[0]
  assert.equal(run.cycleStatus, 'FAILED')
  assert.equal(run.cycles.at(-1)?.reason, 'WRITE_OUTCOME_UNKNOWN')
  assert(snapshot.items.some(i => i.state === 'uncertain' && i.content.type === 'tool_call' && i.content.toolName === 'memory.write'))
  assert.equal((await f.workspace.spaces.memory.files.read('uncertain.md')).content, 'Committed once')
  const state = f.backend.chats.protectedState(ids.sessionId).join('\n'); assert(state.includes('uncertain.md')); assert(state.includes('uncertain')); assert(!state.includes('Committed once'))
  assert.equal((await f.mcp.session('ask-ai', signal, 'read-back')).signal.aborted, false)
})
