import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { firstPartyFixture } from './first-party-fixture'
import { createMCPClient } from '../src/platform/mcp/client'
import { createExternalRun } from '../src/platform/mcp/external-run'
import { createAdmissionBroker } from '../src/platform/mcp/run-admission-broker'
import { createRunAdmission } from '../src/platform/mcp/run-admission'
import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import { scriptedModel, capabilities } from './disclosure-fixture'
import { until } from './tool-fixtures'
const signal = () => new AbortController().signal

for (const ending of ['answer', 'cancel', 'run-end', 'abort'] as const) test(`internal Human Ask ${ending} uses real MCP and never changes the business guard`, async t => {
  const f = await firstPartyFixture(t), tools = await f.askRun(signal(), 'human', [randomUUID()])
  await tools.call('job.list', {}, signal()); const before = tools.getRunGuardSnapshot()
  const controller = new AbortController(), pending = tools.call('human.ask', { question: 'Direction?', options: ['Backend', 'Full stack'] }, controller.signal)
  const checked = ending === 'run-end' || ending === 'abort' ? assert.rejects(pending) : pending
  await until(() => f.human.list().length === 1)
  assert.equal(f.database.connection.isTransaction, false)
  assert.deepEqual(tools.getRunGuardSnapshot(), before)
  await tools.call('scope.profile', {}, signal()) // No business lock is held across the human wait.
  assert.deepEqual(tools.getRunGuardSnapshot(), before)
  const id = f.human.list()[0].id
  if (ending === 'answer') f.human.answer(id, { selectedOption: 'Backend', text: 'Prefer APIs' })
  if (ending === 'cancel') f.human.cancel(id)
  if (ending === 'run-end') await f.endAskRun()
  if (ending === 'abort') controller.abort()
  const result = await checked
  if (ending === 'answer') assert.deepEqual(result, { status: 'submitted', selectedOption: 'Backend', text: 'Prefer APIs' })
  if (ending === 'cancel') assert.deepEqual(result, { status: 'cancelled' })
  await until(() => f.human.list().length === 0)
  assert.throws(() => f.human.answer(id, { selectedOption: null, text: 'stale' }), { code: 'TOOL_NOT_FOUND' })
})

test('external Human Ask and Memory require the owning Session and execution Run; disconnect invalidates waits', async t => {
  const f = await firstPartyFixture(t)
  const client = createMCPClient({ id: 'external', enabled: true, transport: 'stdio', command: process.execPath, args: [join(f.directory, 'job-agent-mcp.js')], tools: [] }, { closed() {}, changed() {} }, { processEnv: { JOB_BROWSER_USER_DATA: f.directory, ELECTRON_RUN_AS_NODE: '1' } })
  f.cleanup(() => client.close()); await client.connect()
  const names = (await client.listTools()).map(tool => tool.name)
  assert(names.includes('human.ask')); assert(!names.some(name => name.startsWith('scope.')))
  assert(!names.some(name => /^knowledge.(write|mkdir|move|delete)$/.test(name)))
  const denied = await client.callTool('human.ask', { executionRunId: randomUUID(), question: 'Unauthorized?' }, signal()) as { isError?: boolean }
  assert(denied.isError); assert.equal(f.human.list().length, 0)
  const begin = await client.callTool('run.begin', {}, signal()) as { structuredContent: { runId: string } }, executionRunId = begin.structuredContent.runId
  const saved = await client.callTool('memory.write', { executionRunId, path: 'external.md', content: 'Prefer concise wording.', expectedRevision: null }, signal()) as { isError?: boolean }
  assert(!saved.isError)
  const waiting = client.callTool('human.ask', { executionRunId, question: 'Choose?', options: [] }, signal())
  await until(() => f.human.list().length === 1)
  f.human.answer(f.human.list()[0].id, { selectedOption: null, text: 'My choice' })
  assert.deepEqual((await waiting as { structuredContent: unknown }).structuredContent, { status: 'submitted', selectedOption: null, text: 'My choice' })
  const abandoned = client.callTool('human.ask', { executionRunId, question: 'Wait?' }, signal()), checked = assert.rejects(abandoned)
  await until(() => f.human.list().length === 1); await client.close(); await checked
  await until(() => f.human.list().length === 0)
  assert.equal((await f.workspace.spaces.memory.call('read', { path: 'external.md' })).ok, true)
})

test('external Human Ask never extends the Run deadline or releases admission during the wait', async t => {
  const f = await firstPartyFixture(t), admission = createRunAdmission(), broker = createAdmissionBroker(f.directory, admission, 150, f.human)
  await broker.ready; f.cleanup(() => broker.close())
  const external = createExternalRun(f.directory); f.cleanup(() => external.close())
  const { runId } = await external.begin()
  const pending = external.ask(runId, { question: 'Waiting?' }, signal()), checked = assert.rejects(pending)
  await until(() => f.human.list().length === 1)
  assert.throws(() => admission.acquire('other'), { code: 'TOOL_BUSY' })
  assert.equal(f.database.connection.isTransaction, false)
  await checked; await until(() => f.human.list().length === 0)
  await external.close()
})

test('Human waiting status is persisted while the model pauses and clears on submission', async t => {
  const f = await firstPartyFixture(t)
  const model = scriptedModel((request, round) => {
    if (round === 1) return [{ name: 'human.ask', arguments: { question: 'Direction?' } }]
    if (round === 2) {
      assert(request.messages.some(message => message.role === 'tool' && message.content.includes('Backend')))
      return JSON.stringify({ status: 'ready', prompt: 'The user chose Backend.' })
    }
    assert.deepEqual(request.messages.map(message => message.role), ['system', 'user'])
    assert(request.messages[1].content.includes('Ask me'))
    assert(request.messages[1].content.includes('The user chose Backend.'))
    return 'Thanks'
  })
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, language: () => 'en', model: () => model.model, capabilities: async () => capabilities })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, { requestId: randomUUID(), message: 'Ask me', choice: { providerId: 'fixture', modelId: 'test' } }, () => {})
  await until(() => f.human.list().length === 1)
  assert.equal(tasks.getRun(1, { runId: ids.runId }).run.runtimeStatus, 'human.waiting'); assert.equal(model.requests.length, 1)
  f.human.answer(f.human.list()[0].id, { selectedOption: null, text: 'Backend' })
  await until(() => tasks.getRun(1, { runId: ids.runId }).run.state !== 'running')
  assert.equal(tasks.getRun(1, { runId: ids.runId }).run.state, 'completed')
  assert.equal(model.requests.length, 3)
})

for (const scenario of ['optional', 'essential', 'run'] as const) test(`Ask handles a cancelled ${scenario} wait`, async t => {
  const f = await firstPartyFixture(t)
  const blockedReason = '缺少必要信息。'
  const model = scriptedModel((request, round) => {
    if (round === 1) return [{ name: 'human.ask', arguments: { question: '你想使用哪个档案？', options: ['档案 A', '档案 B'] } }]
    assert.notEqual(scenario, 'run', 'No new model request after Run cancellation')
    if (round === 2) {
      assert.deepEqual(JSON.parse(request.messages.at(-1)!.content), { status: 'cancelled' })
      return scenario === 'essential' ? JSON.stringify({ status: 'blocked', reason: blockedReason })
        : '{"status":"ready","prompt":"Use the confirmed facts."}'
    }
    assert.equal(scenario, 'optional')
    assert.match(request.messages[0].content, /遇到新的必要业务决定时，调用 human.ask/)
    if (round === 3) return [{ name: 'human.ask', arguments: { question: '要显示哪些内容？' } }]
    assert.deepEqual(JSON.parse(request.messages.at(-1)!.content), { status: 'submitted', selectedOption: null, text: '仅显示项目' })
    return '已汇总项目。'
  })
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, language: () => 'zh-CN',
    model: () => model.model, capabilities: async () => capabilities })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, { requestId: randomUUID(), message: '帮我整理资料', choice: { providerId: 'fixture', modelId: 'test' } }, () => {})
  const current = () => tasks.getRun(1, { runId: ids.runId }).run
  await until(() => f.human.list().length === 1)
  assert.equal(current().runtimeStatus, 'human.waiting')
  const first = f.human.list()[0]
  if (scenario === 'run') tasks.cancel(1, { runId: ids.runId })
  else f.human.cancel(first.id)
  if (scenario === 'optional') {
    await until(() => f.human.list().some(question => question.id !== first.id))
    assert.equal(current().runtimeStatus, 'human.waiting')
    f.human.answer(f.human.list()[0].id, { selectedOption: null, text: '仅显示项目' })
  }
  await until(() => current().state !== 'running')
  assert.equal(current().state, scenario === 'run' ? 'cancelled' : 'completed', current().error ?? '')
  assert.equal(current().blockedReason, scenario === 'essential' ? blockedReason : undefined)
  assert.equal(current().writeStarted, false)
  assert.equal(model.requests.length, scenario === 'run' ? 1 : scenario === 'essential' ? 2 : 4)
  assert.equal(f.human.list().length, 0)
})
