import { ToolError } from '../src/shared/tools/errors'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { firstPartyFixture } from './first-party-fixture'
import { createFixtureAskTasks as createAskAgentTasks } from './ask-fixture'
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
test('Ask AI streams read/write tools over real first-party MCP, stores full tool details, and keeps ordered events', async t => {
  const f = await firstPartyFixture(t), events: AgentRunEvent[] = []
  const batches = [batch({ id: 'jobs', name: 'job.list', arguments: {} }), batch({ id: 'profiles', name: 'profile.list', arguments: {} }),
    batch({ id: 'note', name: 'application.add_note', arguments: { requestId: randomUUID(), jobId: f.job.id, text: 'PRIVATE_NOTE_BODY' } }),
    batch({ id: 'status', name: 'application.set_status', arguments: { jobId: f.job.id, status: 'APPLIED' } }), answer('Done')]
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream(input) {
    assert(input.tools.some(tool => tool.name === 'scope.profile'))
    yield* batches.shift()!
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const input = start('Add a note and mark applied'), ids = tasks.start(1, input, e => events.push(e))
  assert.deepEqual(tasks.start(1, input, () => {}), ids)
  const snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.state, 'completed'); assert(snapshot.run.writeStarted)
  assert.equal(snapshot.items.filter(i => i.content.type === 'tool_call' && !i.content.toolName.startsWith('scope.')).length, 4)
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE_NOTE_BODY'), true)
  assert.equal(f.backend.jobs.getJob({ id: f.job.id }).applicationStatus, 'APPLIED')
  assert.equal(f.backend.applications.listEvents({ jobId: f.job.id }).items.filter(e => e.type === 'NOTE').length, 1)
  assert(events.every((e, index) => e.eventSequence === index + 1))
  assert.equal(f.backend.chats.snapshot(ids.runId).run.eventSequence, events.at(-1)?.eventSequence)

  assert.throws(() => tasks.getRun(2, { runId: ids.runId }), { code: 'FORBIDDEN' })
})
test('global single Run rejects a second session while same-session turns retain FIFO and targeted cancellation', async t => {
  const f = await firstPartyFixture(t)
  let streaming = 0
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream(input) {
    streaming++
    yield { type: 'reasoning.delta', text: 'Visible summary' }
    await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }))
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const a = tasks.start(1, start('A'), () => {})
  for (let n = 0; n < 500 && streaming < 1; n++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(streaming, 1)
  const b = tasks.start(1, start('B'), () => {})
  const denied = await wait(tasks, b.runId)
  assert.equal(denied.run.state, 'failed'); assert.equal(denied.run.error, 'TOOL_BUSY'); assert.equal(streaming, 1)
  const queued = tasks.start(1, start('Again', a.sessionId), () => {})
  assert.equal(tasks.getRun(1, { runId: queued.runId }).run.admission, 'pending')
  assert.throws(() => tasks.cancel(2, { runId: a.runId }), { code: 'FORBIDDEN' })
  tasks.cancel(1, { runId: a.runId }); assert.equal((await wait(tasks, a.runId)).run.state, 'cancelled')
  for (let n = 0; n < 500 && streaming < 2; n++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(streaming, 2)
  tasks.disposeOwner(1); assert.equal((await wait(tasks, queued.runId)).run.state, 'cancelled')
  assert.equal(f.backend.chats.getRun(b.runId).modelId, choice.modelId)
  assert.equal(tasks.listActive(1, {}).length, 0)
})

test('uncertain write responses stop execution without offering a replay and retains attempted inputs', async t => {
  const f = await firstPartyFixture(t), input = start('Add a note'), events: AgentRunEvent[] = []
  const open = f.mcp.openAgentRun.bind(f.mcp)
  f.mcp.openAgentRun = async (...args) => {
    const run = await open(...args), call = run.tools.call.bind(run.tools)
    run.tools.call = async (name, input, signal) => {
      const output = await call(name, input, signal)
      if (name === 'application.add_note' || name === 'job.import') throw new ToolError('TOOL_EXECUTION_FAILED')
      return output
    }
    return run
  }
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream() {
    yield* batch({ id: 'note', name: 'application.add_note', arguments: { requestId: randomUUID(), jobId: f.job.id, text: 'Uncertain committed note' } })
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const ids = tasks.start(1, input, e => events.push(e)), snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.state, 'failed'); assert.equal(snapshot.run.error, 'TOOL_EXECUTION_FAILED'); assert(snapshot.run.writeStarted)
  assert.equal(snapshot.items.at(-1)?.state, 'uncertain')
  assert.equal(f.backend.applications.listEvents({ jobId: f.job.id }).total, 1)
  assert(JSON.stringify(snapshot).includes('Uncertain committed note'))
  assert(events.some(event => event.type === 'run.failed'))
})

test('Ask AI imports ordinary job data without exposing unavailable write interfaces', async t => {
  const f = await firstPartyFixture(t); let step = 0
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream(input) {
    const system = input.messages.find(m => m.role === 'system')?.content ?? ''
    assert.doesNotMatch(system, /profile\.(?:create|update|add_item|update_item|add_fact|update_fact)|resume\.|artifact\.build|Tailor Resume/)
    if (step++ === 0) yield* batch({ id: 'import', name: 'job.import', arguments: { requestId: randomUUID(), details: { title: 'PRIVATE_IMPORTED_JOB', companyNameRaw: 'Fixture' } } })
    else yield* answer('Saved the job. I can read your profile and existing documents.')
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const ids = tasks.start(1, start('Save this job and create a tailored resume'), () => {}), snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.state, 'completed', snapshot.run.error ?? '')
  assert.equal(f.backend.jobs.listJobs({ search: 'PRIVATE_IMPORTED_JOB' }).total, 1)
  assert.equal(f.backend.resumes.listRuns({}).total, 0); assert.equal(f.outputs(), 0)
})

for (const name of ['resume.start', 'resume.rewrite_bullet', 'resume.attach_agent', 'resume.validate', 'resume.publish', 'resume.cancel', 'resume.fail', 'artifact.build']) test(`Ask AI refuses activation of ${name} without a business call`, async t => {
  const f = await firstPartyFixture(t)
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream() {
    yield* batch({ id: 'forbidden', name, arguments: {} })
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const ids = tasks.start(1, start('Create or control a resume'), () => {}), snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.error, 'AGENT_PROTOCOL_ERROR')
  assert.equal(snapshot.run.writeStarted, false)
  assert.equal(f.backend.resumes.listRuns({}).total, 0); assert.equal(f.outputs(), 0)
})

test('uncertain job import marks the new write and never replays it', async t => {
  const f = await firstPartyFixture(t)
  let calls = 0
  const open = f.mcp.openAgentRun.bind(f.mcp)
  f.mcp.openAgentRun = async (...args) => {
    const run = await open(...args), call = run.tools.call.bind(run.tools)
    run.tools.call = async (name, input, signal) => {
      const output = await call(name, input, signal)
      if (name === 'application.add_note' || name === 'job.import') throw new ToolError('TOOL_EXECUTION_FAILED')
      return output
    }
    return run
  }
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream() {
    calls++;
    yield* batch({ id: 'import', name: 'job.import', arguments: { requestId: randomUUID(), details: { title: 'PRIVATE_UNCERTAIN_IMPORT', companyNameRaw: 'Fixture' } } })
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const ids = tasks.start(1, start('Save this job'), () => {}), snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.error, 'TOOL_EXECUTION_FAILED'); assert(snapshot.run.writeStarted)
  assert.equal(snapshot.items.at(-1)?.state, 'uncertain'); assert.equal(calls, 1)
  assert.equal(f.backend.jobs.listJobs({ search: 'PRIVATE_UNCERTAIN_IMPORT' }).total, 1)
  assert(JSON.stringify(snapshot).includes('PRIVATE_UNCERTAIN_IMPORT'))
})

test('Ask AI reads user-maintained Knowledge through MCP without write permission', async t => {
  const f = await firstPartyFixture(t)
  await f.workspace.spaces.knowledge.files.mkdir('interview')
  await f.workspace.spaces.knowledge.files.write('interview/notes.md', 'PRIVATE_KNOWLEDGE_BODY pricing', null)
  let step = 0
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream(input) {
    assert(input.tools.every(tool => !/^knowledge.(write|mkdir|move|delete)$/.test(tool.name)))
    const calls = [['knowledge.search', { query: 'pricing' }], ['knowledge.read', { path: 'interview/notes.md' }], ['knowledge.retrieve', { query: 'pricing', maxContext: 500 }]] as const
    if (step === calls.length) { yield* answer('Here are your notes.'); return }
    const [name, args] = calls[step++]; yield* batch({ id: `knowledge-${step}`, name, arguments: args })
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const ids = tasks.start(1, start('Read my interview preparation'), () => {}), snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.state, 'completed', snapshot.run.error ?? ''); assert.equal(snapshot.run.writeStarted, false)
  assert(JSON.stringify(snapshot).includes('PRIVATE_KNOWLEDGE_BODY'))
  assert.equal((await f.workspace.spaces.knowledge.files.read('interview/notes.md')).content, 'PRIVATE_KNOWLEDGE_BODY pricing')
})
