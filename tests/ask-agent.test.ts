import { ToolError } from '../src/shared/tools/errors'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { firstPartyFixture } from './first-party-fixture'
import { createAskAgentTasks as createRealAskTasks } from '../src/platform/electron/ask-agent-tasks'
import { chatDebugExportRepository } from '../src/platform/database/repositories/chat-debug-export'
import { descriptor, scriptedModel } from './disclosure-fixture'
import { afterAskToolCall, createFixtureAskTasks as createAskAgentTasks, fixtureCapabilities } from './ask-fixture'
import type { AgentModelEvent, StreamingAgentModel, AgentToolCall } from '../src/shared/agent'
import type { AgentRunEvent } from '../src/domain/chat/chat.types'
import type { Language } from '../src/shared/settings'
import { parsePreparation } from '../src/platform/agent/prepare'
import { askReadTools } from '../src/shared/agent/ask-policy'
import { runAskWorkflow } from '../src/platform/agent/engine/ask-workflow'
import { until } from './tool-fixtures'
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
  afterAskToolCall(f.mcp, 'application.add_note', () => { throw new ToolError('TOOL_EXECUTION_FAILED') })
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
  afterAskToolCall(f.mcp, 'job.import', () => { throw new ToolError('TOOL_EXECUTION_FAILED') })
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

test('Prepare filters the Scope directory and shares a single Run with isolated Execute input', async t => {
  const f = await firstPartyFixture(t), events: AgentRunEvent[] = []
  let opened = 0, capabilities = 0, round = 0
  const open = f.mcp.openAgentRun.bind(f.mcp)
  f.mcp.openAgentRun = async input => { opened++; return open(input) }
  const script = scriptedModel((request, step) => {
    round = step
    const messages = request.messages
    const listed = (name: string) => request.tools.some(tool => tool.function.description.startsWith(`[${name}]`))
    if (step === 1) {
      assert(messages[0].content.startsWith('Prepare a self-contained handoff'))
      return [{ name: 'scope.application', arguments: {} }]
    }
    if (step === 2) {
      assert(listed('application.get')); assert(!listed('application.add_note'))
      const directory = messages.filter(message => message.role === 'tool').at(-1)!.content
      assert(directory.includes('application.get')); assert(!directory.includes('application.add_note'))
      return [{ name: 'application.get', arguments: { jobId: f.job.id } }]
    }
    if (step === 3) return JSON.stringify({ status: 'ready', prompt: `Apply the confirmed action to job ${f.job.id}.` })
    if (step === 4) {
      assert(!messages.some(message => message.role === 'tool' || message.role === 'assistant'))
      assert(messages.at(-1)!.content.includes('Original Request:\nAdd a note'))
      assert(messages.at(-1)!.content.includes(`Apply the confirmed action to job ${f.job.id}.`))
      return [{ name: 'scope.application', arguments: {} }]
    }
    if (step === 5) {
      assert(listed('application.add_note'))
      return [{ name: 'application.add_note', arguments: { jobId: f.job.id, requestId: randomUUID(), text: 'Committed before final response' } }]
    }
    assert.equal(f.backend.applications.listEvents({ jobId: f.job.id }).total, 1)
    return 'Note saved.'
  })
  const tasks = createRealAskTasks({ chats: f.backend.chats, mcp: f.mcp, language: () => 'en', model: () => script.model,
    capabilities: async () => { capabilities++; return fixtureCapabilities } })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, start('Add a note'), event => events.push(event))
  const snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.state, 'completed', snapshot.run.error ?? '')
  assert.equal(round, 6); assert.equal(opened, 1); assert.equal(capabilities, 1)
  assert(events.some(event => event.type === 'runtime.status' && event.status === 'preparing'))
  assert(events.some(event => event.type === 'runtime.status' && event.status === 'executing'))
  const debug = chatDebugExportRepository(f.database.connection).getDebugBundle(ids.sessionId).runs[0]
  assert.equal(debug.preparation?.status, 'ready')
  assert.deepEqual(debug.cycles.map(cycle => [cycle.index, cycle.phase, cycle.modelRequestOrdinal]), [
    [1, 'prepare', 1], [2, 'prepare', 2], [3, 'prepare', 3], [4, 'execute', 4], [5, 'execute', 5], [6, 'execute', 6]
  ])
  assert.deepEqual(debug.providerResponses.map(response => response.cycle_index), [1, 2, 3, 4, 5, 6])
  const history = f.backend.chats.contextTurns(ids.sessionId, Number.MAX_SAFE_INTEGER).flatMap(turn => turn.messages)
  assert(history.some(message => message.role === 'user' && message.content === 'Add a note'))
  assert(history.some(message => message.role === 'assistant' && message.content === 'Note saved.'))
  assert(!JSON.stringify(history).includes('Apply the confirmed action'))
  assert(!history.some(message => message.role === 'assistant' && message.toolCalls.some(call => call.name === 'application.get')))
})

for (const [content, state] of [
  ['{"status":"blocked","reason":"Please choose a profile."}', 'completed'],
  ['{"status":"ready","prompt":"", "reason":"invalid"}', 'failed']
] as const) test(`Prepare ${state} settles without an Execute stage`, async t => {
  const f = await firstPartyFixture(t)
  const script = scriptedModel(() => content)
  const tasks = createRealAskTasks({ chats: f.backend.chats, mcp: f.mcp, language: () => 'en', model: () => script.model, capabilities: async () => fixtureCapabilities })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, start('Prepare profile task'), () => {})
  const snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.state, state)
  assert.equal(script.requests.length, 1)
  const run = chatDebugExportRepository(f.database.connection).getDebugBundle(ids.sessionId).runs[0]
  assert.deepEqual(run.cycles.map(cycle => [cycle.phase, cycle.status]), [['prepare', state === 'completed' ? 'SUCCESS' : 'FAILED']])
  if (state === 'completed') assert.equal(f.backend.chats.getRun(ids.runId).blockedReason, 'Please choose a profile.')
  else assert.equal(snapshot.run.error, 'AGENT_PROTOCOL_ERROR')
})

test('Prepare rejects a write before dispatch even when the model fabricates a tool call', async t => {
  const f = await firstPartyFixture(t)
  const script = scriptedModel((_request, step) => step === 1 ? [{ name: 'scope.application', arguments: {} }] :
    [{ name: 'application.add_note', arguments: { jobId: f.job.id, requestId: randomUUID(), text: 'Forbidden' } }])
  const tasks = createRealAskTasks({ chats: f.backend.chats, mcp: f.mcp, language: () => 'en', model: () => script.model, capabilities: async () => fixtureCapabilities })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, start('Add a note'), () => {}), snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.error, 'AGENT_PROTOCOL_ERROR')
  assert.equal(snapshot.run.writeStarted, false)
  assert.equal(f.backend.applications.listEvents({ jobId: f.job.id }).total, 0)
})

test('Prepare accepts complete JSON envelopes and retains only the trimmed protocol fields', () => {
  const fence = '```'
  const ready = { status: 'ready', prompt: 'Update preferences.md.' }
  const blocked = { status: 'blocked', reason: 'Missing the amount.' }
  const raw = JSON.stringify(ready)
  const failureShape = JSON.stringify({ ...ready, prompt: '  Update preferences.md.  ', goal: 'Update salary',
    execution_target: { path: 'preferences.md' }, confirmed_facts: { salary: '1.8w × 12个月' } })
  for (const input of [raw, '  ' + raw + '\n', fence + 'JSON \r\n' + failureShape + '\r\n' + fence,
    fence + '\n' + raw + '\n' + fence, failureShape]) {
    assert.deepEqual(parsePreparation(input), ready)
  }
  for (const input of [JSON.stringify(blocked), fence + 'json\n{"status":"blocked","reason":" Missing the amount. ","extra":true}\n' + fence]) {
    assert.deepEqual(parsePreparation(input), blocked)
  }
  for (const input of [
    '{"status":"ready","prompt":" "}', '{"status":"blocked","reason":""}', '{"status":"ready","goal":"missing prompt"}',
    '{"status":"blocked","reason":false}', '{"status":"other","prompt":"Task"}', '{"status":',
    'Result: ' + raw, raw + '\n' + raw, '[' + raw + ']', 'null', fence + 'js\n' + raw + '\n' + fence
  ]) assert.throws(() => parsePreparation(input), { code: 'AGENT_PROTOCOL_ERROR' })
})

test('Ask rejects a tool client without views and treats unclassified descriptors as ineligible for Prepare', async () => {
  const catalog = [
    descriptor('job.get'),
    { ...descriptor('job.list'), risk: 'READ' as const },
    { ...descriptor('memory.recall'), risk: 'COMPUTE' as const },
    { ...descriptor('memory.write'), risk: 'WRITE' as const },
    { ...descriptor('profile.update'), risk: 'READ' as const }
  ]
  const allow = ['job.get', 'job.list', 'memory.recall', 'memory.write']
  assert.deepEqual(askReadTools(catalog, allow), ['job.list', 'memory.recall'])
  await assert.rejects(runAskWorkflow({
    invocation: { agent: 'ask', source: 'chat', language: 'en', sessionId: 'fixture', message: 'Write memory' },
    run: { cycleIndex: 0, loadCore: async () => assert.fail(), stage: async () => assert.fail() },
    tools: { list: async () => catalog, call: async () => assert.fail('No calls through the unrestricted client') },
    allow, signal: new AbortController().signal, emit() {}, status() {}
  }), { code: 'AGENT_PROTOCOL_ERROR' })
})

test('Ask MCP views filter Scope results and direct calls while sharing one guard', async t => {
  const f = await firstPartyFixture(t)
  const signal = new AbortController().signal
  const tools = await f.askRun(signal, 'views', [randomUUID()])
  const prepare = tools.view(['memory.list'])
  const execute = tools.view(['memory.list', 'memory.write'])
  assert.deepEqual((await prepare.list()).map(tool => tool.name).sort(), ['human.ask', 'memory.list', 'scope.memory'])
  const directory = await prepare.call('scope.memory', {}, signal) as { tools: { name: string }[] }
  assert.deepEqual(directory.tools.map(tool => tool.name), ['memory.list'])
  const write = { path: 'test.md', content: 'Saved', expectedRevision: null }
  await assert.rejects(prepare.call('memory.write', write, signal), { code: 'TOOL_FORBIDDEN' })
  await prepare.call('memory.list', {}, signal)
  const before = prepare.getRunGuardSnapshot()
  assert(before)
  assert.deepEqual(execute.getRunGuardSnapshot(), before)
  await execute.call('memory.write', write, signal)
  const after = execute.getRunGuardSnapshot()
  assert.equal(after?.executionRunId, before.executionRunId)
  assert.equal(after?.calls, before.calls + 1)
  assert.deepEqual(prepare.getRunGuardSnapshot(), after)
})

test('salary update carries the confirmed value into Execute and writes against the latest revision', async t => {
  const f = await firstPartyFixture(t)
  const path = 'preferences.md', salary = '1.8w × 12个月，年包21.6w'
  const memory = f.workspace.spaces.memory.files
  const initial = await memory.write(path, '薪资预期：待定\n地点：悉尼\n', null)
  const handoff = `更新 ${path} 的薪资预期为 ${salary}。执行前读取当前 revision，保留其他偏好。`
  const request = '我要更新薪资预期。Please respond in English.'
  let language: Language = 'zh-CN', reads = 0, revision = ''
  const script = scriptedModel(async (input, step) => {
    const system = input.messages[0].content
    assert.match(system, /用户明确指定语言时优先遵从/)
    const has = (name: string) => input.tools.some(tool => tool.function.description.startsWith(`[${name}] `))
    const last = () => JSON.parse(input.messages.at(-1)!.content.split('\nRunGuard guidance:')[0])
    assert(has('human.ask'))
    if (step <= 5) {
      assert.match(system, /你是 Job Agent Browser 的 Prepare 阶段/)
      assert.match(system, /只询问影响结果的业务问题/)
      assert(!has('memory.write'))
      if (step === 1) return [{ name: 'scope.memory', arguments: {} }]
      if (step === 2) {
        assert(last().tools.every((tool: { name: string }) => !['memory.write', 'memory.mkdir'].includes(tool.name)))
        return [{ name: 'memory.recall', arguments: { query: '薪资预期' } }]
      }
      if (step === 3) return [{ name: 'human.ask', arguments: { question: 'What salary should I save?' } }]
      if (step === 4) {
        assert.equal(last().text, salary)
        return [{ name: 'memory.read', arguments: { path } }]
      }
      assert.equal(last().revision, initial.revision)
      return '```json\r\n' + JSON.stringify({ status: 'ready', prompt: handoff, goal: 'Update salary',
        execution_target: { path }, confirmed_facts: { salary } }) + '\r\n```'
    }
    assert.match(system, /你是 Job Agent Browser 的 Execute 阶段/)
    assert.match(system, /不要重复询问 Prepare 已经确认的内容/)
    if (step === 6) {
      assert(!has('memory.read'))
      assert.deepEqual(input.messages.map(message => message.role), ['system', 'user', 'user'])
      assert.match(input.messages[1].content, /Protected execution state/)
      assert.equal(input.messages.at(-1)!.content, `Original Request:\n${request}\n\nPrepared Task:\n${handoff}`)
      revision = (await memory.write(path, '薪资预期：待定\n地点：悉尼\n远程：可选\n', initial.revision)).revision
      return [{ name: 'scope.memory', arguments: {} }]
    }
    if (step === 7) {
      assert(has('memory.write'))
      return [{ name: 'memory.read', arguments: { path } }]
    }
    if (step === 8) {
      assert.equal(last().revision, revision)
      return [{ name: 'memory.write', arguments: { path, content: last().content.replace('待定', salary), expectedRevision: revision } }]
    }
    assert(last().revision)
    return 'Salary expectation saved.'
  })
  const next = scriptedModel((input, step) => {
    assert.match(input.messages[0].content, /Use English .* unless the user explicitly requests a different language/)
    return step === 1 ? '{"status":"ready","prompt":"Answer the request."}' : 'Done.'
  })
  const tasks = createRealAskTasks({ chats: f.backend.chats, mcp: f.mcp, language: () => { reads++; return language },
    model: ({ modelId }) => modelId === 'next' ? next.model : script.model, capabilities: async () => fixtureCapabilities })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, start(request), () => {})
  await until(() => f.human.list().length === 1, 'salary question', 5000)
  assert.equal(tasks.getRun(1, { runId: ids.runId }).run.runtimeStatus, 'human.waiting')
  assert.equal(tasks.getRun(1, { runId: ids.runId }).run.writeStarted, false)
  assert.equal(f.human.list()[0].question, 'What salary should I save?')
  language = 'en'
  f.human.answer(f.human.list()[0].id, { selectedOption: null, text: salary })
  const snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.state, 'completed', snapshot.run.error ?? '')
  assert.equal(reads, 1)
  assert.equal(script.requests.length, 9)
  assert.equal((await memory.read(path)).content, `薪资预期：${salary}\n地点：悉尼\n远程：可选\n`)
  const calls = snapshot.items.flatMap(item => item.content.type === 'tool_call' ? [[item.phase, item.content.toolName]] : [])
  assert.deepEqual(calls, [
    ['prepare', 'scope.memory'], ['prepare', 'memory.recall'], ['prepare', 'human.ask'], ['prepare', 'memory.read'],
    ['execute', 'scope.memory'], ['execute', 'memory.read'], ['execute', 'memory.write']
  ])
  const debug = chatDebugExportRepository(f.database.connection).getDebugBundle(ids.sessionId).runs[0]
  assert.equal(debug.preparation?.status, 'ready')
  assert.equal(debug.preparation?.prompt, handoff)
  assert.deepEqual(debug.cycles.map(cycle => [cycle.index, cycle.phase]), [
    [1, 'prepare'], [2, 'prepare'], [3, 'prepare'], [4, 'prepare'], [5, 'prepare'],
    [6, 'execute'], [7, 'execute'], [8, 'execute'], [9, 'execute']
  ])
  assert(snapshot.items.some(item => item.phase === 'execute' && item.content.type === 'assistant_message'
    && item.content.text === 'Salary expectation saved.'))
  const later = tasks.start(1, { ...start('Next request'), choice: { ...choice, modelId: 'next' } }, () => {})
  assert.equal((await wait(tasks, later.runId)).run.state, 'completed')
  assert.equal(next.requests.length, 2)
  assert.deepEqual(script.requests[0].tools.find(tool => tool.function.description.startsWith('[human.ask]')),
    next.requests[0].tools.find(tool => tool.function.description.startsWith('[human.ask]')))
  assert.equal(reads, 2)
})
