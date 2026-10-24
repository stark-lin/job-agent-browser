import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { firstPartyFixture } from './first-party-fixture'
import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import type { AgentModelEvent, StreamingAgentModel, AgentToolCall } from '../src/shared/agent'
import type { AgentRunEvent } from '../src/domain/chat/chat.types'
const choice = { providerId: 'fixture', modelId: 'test' }
const start = (message: string, sessionId?: string) => ({ requestId: randomUUID(), message, sessionId, choice })
async function wait(tasks: ReturnType<typeof createAskAgentTasks>, runId: string) {
  for (let n = 0; n < 500; n++) { const s = tasks.getRun(1, { runId }); if (s.run.state !== 'running') return s; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw new Error('Ask task timeout')
}
function answer(text: string): AgentModelEvent[] { return [{ type: 'content.delta', text }, { type: 'completed', response: { content: text, toolCalls: [] } }] }
function batch(call: AgentToolCall): AgentModelEvent[] { return [{ type: 'tool_call.ready', call }, { type: 'completed', response: { content: '', toolCalls: [call] } }] }
test('Ask AI streams read/write tools over real first-party MCP, stores only summaries, and keeps ordered events', async t => {
  const f = await firstPartyFixture(t), events: AgentRunEvent[] = []
  const batches = [batch({ id: 'jobs', name: 'job.list', arguments: {} }), batch({ id: 'profiles', name: 'profile.list', arguments: {} }),
    batch({ id: 'note', name: 'application.add_note', arguments: { requestId: randomUUID(), jobId: f.job.id, text: 'PRIVATE_NOTE_BODY' } }),
    batch({ id: 'status', name: 'application.set_status', arguments: { jobId: f.job.id, status: 'APPLIED' } }), answer('Done')]
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream(input) {
    assert(!input.tools.some(tool => tool.name === 'resume.start' || tool.name === 'job.import' || tool.name === 'artifact.build'))
    yield* batches.shift()!
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const input = start('Add a note and mark applied'), ids = tasks.start(1, input, e => events.push(e))
  assert.deepEqual(tasks.start(1, input, () => {}), ids)
  const snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.state, 'completed'); assert(snapshot.run.writeStarted)
  assert.equal(snapshot.items.filter(i => i.content.type === 'tool_call').length, 4)
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE_NOTE_BODY'), false)
  assert.equal(f.backend.jobs.getJob({ id: f.job.id }).applicationStatus, 'APPLIED')
  assert.equal(f.backend.applications.listEvents({ jobId: f.job.id }).items.filter(e => e.type === 'NOTE').length, 1)
  assert(events.every((e, index) => e.eventSequence === index + 1))
  assert.equal(f.backend.chats.snapshot(ids.runId).run.eventSequence, events.at(-1)?.eventSequence)
  assert(f.backend.toolAudit.list().filter(a => a.agent_id === 'internal.ask-ai').length >= 8)
  assert.throws(() => tasks.getRun(2, { runId: ids.runId }), { code: 'FORBIDDEN' })
})
test('per-session exclusion, two simultaneous sessions, targeted cancellation, owner disposal and durable model snapshots', async t => {
  const f = await firstPartyFixture(t)
  let streaming = 0
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream(input) {
    streaming++
    yield { type: 'reasoning.delta', text: 'Visible summary' }
    await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }))
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const a = tasks.start(1, start('A'), () => {}), b = tasks.start(1, start('B'), () => {})
  assert.throws(() => tasks.start(1, start('Again', a.sessionId), () => {}), { code: 'INVALID_STATE' })
  for (let n = 0; n < 500 && streaming < 2; n++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(streaming, 2); assert.equal(tasks.listActive(1, {}).length, 2)
  tasks.cancel(1, { runId: a.runId }); assert.equal((await wait(tasks, a.runId)).run.state, 'cancelled')
  assert.equal(tasks.getRun(1, { runId: b.runId }).run.state, 'running')
  assert.throws(() => tasks.cancel(2, { runId: b.runId }), { code: 'FORBIDDEN' })
  tasks.disposeOwner(1); assert.equal((await wait(tasks, b.runId)).run.state, 'cancelled')
  assert.equal(f.backend.chats.getRun(b.runId).modelId, choice.modelId)
  assert.equal(tasks.listActive(1, {}).length, 0)
})

test('uncertain write audits stop execution without offering a replay or storing raw results', async t => {
  const f = await firstPartyFixture(t), input = start('Add a note'), events: AgentRunEvent[] = []
  f.flag('fail-audit-finish')
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream() {
    yield* batch({ id: 'note', name: 'application.add_note', arguments: { requestId: randomUUID(), jobId: f.job.id, text: 'Uncertain committed note' } })
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const ids = tasks.start(1, input, e => events.push(e)), snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.state, 'failed'); assert.equal(snapshot.run.error, 'TOOL_AUDIT_UNAVAILABLE'); assert(snapshot.run.writeStarted)
  assert.equal(snapshot.items.at(-1)?.state, 'uncertain')
  assert.equal(f.backend.applications.listEvents({ jobId: f.job.id }).total, 1)
  assert(!JSON.stringify(snapshot).includes('Uncertain committed note'))
  assert.equal(events.at(-1)?.type, 'run.failed')
})
