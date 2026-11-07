import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { nextAction, resolveCycle, settleCycle, startCycle } from '../src/platform/agent/react-cycle/machine'
import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import { chatDebugExportRepository } from '../src/platform/database/repositories/chat-debug-export'
import { toolSnapshot } from '../src/platform/ai/agent-request'
import { AgentError, type StreamingAgentModel } from '../src/shared/agent'
import type { RunGuardSnapshot } from '../src/shared/agent/run-guard'
import { firstPartyFixture } from './first-party-fixture'
import { fixtureCapabilities } from './ask-fixture'

const choice = { providerId: 'fixture', modelId: 'test' }
const input = (message: string, sessionId?: string) => ({ requestId: randomUUID(), message, sessionId, choice })
const capability = { ...fixtureCapabilities, contextWindow: 65536 }
const prepared = { ...choice, preparedAt: 'now' }
const answer: StreamingAgentModel = { complete: async () => assert.fail('unexpected summary'), async *stream(request) {
  request.onRequestPrepared?.({ ...prepared, tools: toolSnapshot(request.tools) })
  yield { type: 'content.delta', text: 'Answer' }
  yield { type: 'completed', response: { content: 'Answer', toolCalls: [] } }
} }
async function wait(tasks: ReturnType<typeof createAskAgentTasks>, runId: string) {
  for (let i = 0; i < 500; i++) {
    const snapshot = tasks.getRun(1, { runId })
    if (snapshot.run.state !== 'running') return snapshot
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('Run did not settle')
}

test('Cycle transitions gate starts, settlement and continuation', () => {
  const guard: RunGuardSnapshot = { agentRunId: randomUUID(), status: 'ACTIVE', calls: 4, executedCalls: 4,
    noProgress: 2, rejections: 0, progress: 2, executed: true, effectAlreadyConfirmed: false, effects: [] }
  const base = { fatal: false, cancelled: false, finalAnswer: false }
  assert.equal(resolveCycle(base), 'CONTINUE')
  assert.equal(resolveCycle({ ...base, guard: { ...guard, level: 'warning' } }), 'WARNING')
  assert.equal(resolveCycle({ ...base, guard: { ...guard, level: 'recovery' } }), 'RECOVERING')
  assert.equal(resolveCycle({ ...base, finalAnswer: true, guard: { ...guard, level: 'recovery' } }), 'SUCCESS')
  assert.equal(resolveCycle({ ...base, finalAnswer: true, cancelled: true }), 'CANCELLED')
  assert.equal(resolveCycle({ ...base, fatal: true, cancelled: true }), 'FAILED')
  assert.equal(resolveCycle({ ...base, cancelled: true, guard: { ...guard, status: 'BLOCKED' } }), 'FAILED')
  for (const [state, action] of [[null, 'CONTINUE'], ['CONTINUE', 'CONTINUE'], ['WARNING', 'CONTINUE_WITH_WARNING'], ['RECOVERING', 'RECOVER']] as const) {
    assert.equal(nextAction(state), action)
    assert.equal(startCycle(state), 'RUNNING')
    assert.throws(() => settleCycle(state, 'FAILED'))
  }
  assert.throws(() => startCycle('RUNNING'))
  for (const state of ['SUCCESS', 'FAILED', 'CANCELLED'] as const) {
    assert.equal(settleCycle('RUNNING', state), state)
    assert.equal(nextAction(state), 'STOP')
    assert.throws(() => startCycle(state))
    assert.throws(() => settleCycle(state, state))
  }
})

test('new prompts start at Cycle 1, deduplication preserves identity, and summary ordinals are never Cycle ordinals', async t => {
  const f = await firstPartyFixture(t), repo = f.backend.chats, debug = chatDebugExportRepository(f.database.connection)
  let sessionId: string | undefined
  for (let n = 0; n < 8; n++) {
    const ids = repo.start(input(`Earlier prompt ${n}: ` + 'x'.repeat(6000), sessionId))
    sessionId = ids.sessionId
    const snapshot = repo.snapshot(ids.runId)
    snapshot.run.state = 'completed'; snapshot.run.finishedAt = 'end'; repo.finish(snapshot)
  }
  let summaries = 0, requests = 0
  const tasks = createAskAgentTasks({ chats: repo, mcp: f.mcp, capabilities: async () => capability, model: () => ({
    async complete(request) {
      request.onRequestPrepared?.({ ...prepared, tools: [] })
      summaries++
      return { content: 'Earlier context', toolCalls: [] }
    },
    stream(request) { requests++; return answer.stream(request) }
  }) })
  t.after(() => tasks.dispose())
  const send = input('Answer the current prompt', sessionId), a = tasks.start(1, send, () => {})
  assert.deepEqual(tasks.start(1, send, () => {}), a)
  assert.equal((await wait(tasks, a.runId)).run.state, 'completed')
  const b = tasks.start(1, input('A separate follow-up', sessionId), () => {})
  assert.notEqual(a.runId, b.runId)
  assert.equal((await wait(tasks, b.runId)).run.state, 'completed')
  assert(summaries > 0)
  assert.equal(requests, 2)
  const runs = debug.getDebugBundle(a.sessionId).runs
  for (const id of [a.runId, b.runId]) {
    const run = runs.find(entry => entry.run.id === id)!
    assert.equal(run.cycleStatus, 'SUCCESS')
    assert.deepEqual(run.cycles.map(cycle => [cycle.index, cycle.status]), [[1, 'SUCCESS']])
    const linked = run.modelRequests.find(request => request.ordinal === run.cycles[0].modelRequestOrdinal)
    assert.equal(JSON.parse(linked!.metadata_json).purpose, 'agent-turn')
  }
  assert(runs.find(entry => entry.run.id === a.runId)!.cycles[0].modelRequestOrdinal! > 1)
})

test('preflight failure creates no Cycle and active cancellation settles only its actual Cycle', async t => {
  const f = await firstPartyFixture(t), debug = chatDebugExportRepository(f.database.connection)
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp,
    capabilities: async ({ modelId }) => { if (modelId === 'missing') throw new AgentError('AI_NOT_CONFIGURED'); return capability },
    model: () => ({ ...answer, async *stream(request) {
      entered()
      await new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true }))
    } }) })
  t.after(() => tasks.dispose())
  const a = tasks.start(1, { ...input('Preflight'), choice: { ...choice, modelId: 'missing' } }, () => {})
  assert.equal((await wait(tasks, a.runId)).run.error, 'AI_NOT_CONFIGURED')
  assert.equal(debug.getDebugBundle(a.sessionId).runs[0].cycleStatus, null)
  const b = tasks.start(1, input('Cancel'), () => {})
  await started
  tasks.cancel(1, { runId: b.runId })
  assert.equal((await wait(tasks, b.runId)).run.state, 'cancelled')
  assert.equal(debug.getDebugBundle(b.sessionId).runs[0].cycleStatus, 'CANCELLED')
})

test('terminal transaction rolls back Cycle and Run together, then retries persistence without inference', async t => {
  const f = await firstPartyFixture(t), db = f.database.connection, repo = f.backend.chats, debug = chatDebugExportRepository(db)
  let requests = 0, attempts = 0
  const tasks = createAskAgentTasks({ chats: repo, mcp: f.mcp, capabilities: async () => capability,
    model: () => ({ ...answer, stream(request) { requests++; return answer.stream(request) } }) })
  t.after(() => tasks.dispose())
  const finish = repo.finish.bind(repo)
  let duringRetry: ReturnType<typeof debug.getDebugBundle> | undefined
  t.mock.method(repo, 'finish', (snapshot: Parameters<typeof finish>[0], reason?: string | null) => {
    if (++attempts !== 1) {
      duringRetry = debug.getDebugBundle(snapshot.run.sessionId!)
      return finish(snapshot, reason)
    }
    db.exec(`CREATE TEMP TRIGGER fail_terminal BEFORE UPDATE OF state ON agent_runs
      WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT,'fixture'); END`)
    try { finish(snapshot, reason) }
    finally { db.exec('DROP TRIGGER fail_terminal') }
  })
  const ids = tasks.start(1, input('Answer'), () => {})
  assert.equal((await wait(tasks, ids.runId)).run.state, 'failed')
  assert.equal(duringRetry!.runs[0].run.state, 'running')
  assert.equal(duringRetry!.runs[0].cycleStatus, 'RUNNING')
  assert.equal(debug.getDebugBundle(ids.sessionId).runs[0].cycleStatus, 'FAILED')
  assert.equal(requests, 1); assert.equal(attempts, 2)
})

test('failure preparing the next Pi turn leaves the previous Cycle settled without fabricating another', async t => {
  const f = await firstPartyFixture(t), debug = chatDebugExportRepository(f.database.connection)
  const open = f.mcp.openAgentRun.bind(f.mcp)
  t.mock.method(f.mcp, 'openAgentRun', async (args: Parameters<typeof open>[0]) => {
    const run = await open(args), list = run.tools.list.bind(run.tools)
    let refreshes = 0
    t.mock.method(run.tools, 'list', async () => {
      if (++refreshes > 1) throw new AgentError('AI_PROVIDER_FAILED')
      return list()
    })
    return run
  })
  let requests = 0
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, capabilities: async () => capability, model: () => ({
    ...answer, async *stream() {
      requests++
      const call = { id: 'discover', name: 'tool.search', arguments: { query: 'job' } }
      yield { type: 'tool_call.ready', call }
      yield { type: 'completed', response: { content: '', toolCalls: [call] } }
    }
  }) })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, input('Inspect jobs'), () => {})
  assert.equal((await wait(tasks, ids.runId)).run.state, 'failed')
  const run = debug.getDebugBundle(ids.sessionId).runs[0]
  assert.equal(run.cycleStatus, 'CONTINUE')
  assert.deepEqual(run.cycles.map(c => c.index), [1])
  assert.equal(requests, 1)
})
