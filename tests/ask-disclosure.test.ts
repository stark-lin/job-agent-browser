import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { firstPartyFixture } from './first-party-fixture'
import { activation, capabilities, reply, scriptedModel, type WireRequest } from './disclosure-fixture'
import { DataError } from '../src/domain/common/errors'
import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import { compatibleAgentModel } from '../src/platform/ai/agent-model'
import { stableName } from '../src/platform/ai/agent-protocol'
import { fingerprint } from '../src/platform/ai/agent-request'

test('real HTTP and first-party MCP discover, activate, execute and answer without automatic fixture activation', async t => {
  const f = await firstPartyFixture(t), requests: WireRequest[] = []
  let authorizedSchema: Record<string, unknown> | undefined
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', chunk => { raw += chunk })
    request.on('end', async () => {
      const body = JSON.parse(raw) as WireRequest, ordinal = requests.push(body)
      assert.equal(request.url, '/v1/chat/completions')
      const business = body.tools.find(tool => tool.function.name === stableName('job.list'))
      if (ordinal <= 2) {
        assert.equal(business, undefined)
        assert.equal(body.tools.length, 2)
      } else {
        assert(business); assert.deepEqual(business.function.parameters, authorizedSchema)
        assert(business.function.description.startsWith('[job.list] '))
      }
      if (ordinal === 2) assert(JSON.parse(body.messages.at(-1)!.content).some((entry: { name: string }) => entry.name === 'job.list'))
      if (ordinal === 3) {
        assert.deepEqual(JSON.parse(body.messages.at(-1)!.content).activeOnNextRequest, ['job.list'])
        const history = body.messages.filter(message => message.role === 'assistant').flatMap(message => message.tool_calls ?? [])
        assert.deepEqual(history.map(call => call.function.name), [stableName('tool.search'), stableName('tool.activate')])
      }
      if (ordinal === 4) {
        const result = JSON.parse(body.messages.at(-1)!.content)
        assert.equal(result.total, 1); assert.equal(result.items[0].id, f.job.id)
      }
      const calls = ordinal === 1 ? [{ name: 'tool.search', arguments: { query: 'job list' } }]
        : ordinal === 2 ? [{ name: 'tool.activate', arguments: { names: ['job.list'] } }]
        : ordinal === 3 ? [{ name: 'job.list', arguments: {} }] : 'Saved job found.'
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(await reply(calls, ordinal).text())
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const model = compatibleAgentModel({ provider: { id: 'fixture', name: 'Fixture', baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requiresKey: false, models: ['test'], defaultModel: 'test' }, model: 'test', key: null }, {  })
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model, capabilities: async () => capabilities })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, { requestId: randomUUID(), message: 'Find my saved jobs', choice: { providerId: 'fixture', modelId: 'test' } }, () => {})
  const tools = await f.mcp.session('ask-ai', new AbortController().signal, ids.sessionId)
  authorizedSchema = (await tools.list()).find(tool => tool.name === 'job.list')!.inputSchema
  for (let tries = 0; tries < 1000 && tasks.getRun(1, { runId: ids.runId }).run.state === 'running'; tries++) await new Promise(resolve => setTimeout(resolve, 10))
  const snapshot = tasks.getRun(1, { runId: ids.runId })
  assert.equal(snapshot.run.state, 'completed', snapshot.run.error ?? '')
  assert.equal(requests.length, 4)
  assert(snapshot.items.some(item => item.content.type === 'assistant_message' && item.content.text === 'Saved job found.'))

  const diagnostics = f.backend.chats.listModelRequests(ids.runId, 100, 0)
  assert.equal(diagnostics.total, 4)
  for (const [index, row] of diagnostics.items.entries()) {
    assert.equal(row.ordinal, index + 1); assert.equal(row.verification, 'matched'); assert.equal(row.purpose, 'agent-turn')
    assert.deepEqual(row.expectedTools, row.piTools); assert.deepEqual(row.expectedTools, row.tools)
    assert.deepEqual(row.tools.map(tool => tool.providerName), requests[index].tools.map(tool => tool.function.name))
    assert.deepEqual(row.tools.map(tool => tool.schemaHash), requests[index].tools.map(tool => fingerprint(tool.function.parameters)))
  }
  f.backend.chats.deleteSession(ids.sessionId)
  assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM agent_model_requests WHERE run_id=?').get(ids.runId)?.n, 0)
  assert.equal(f.backend.jobs.getJob({ id: f.job.id }).id, f.job.id)
})
test('activation loop fails the persisted Run, retains diagnostics, and stops the remaining MCP batch', async t => {
  const f = await firstPartyFixture(t)
  const fixture = scriptedModel((_body, ordinal) => ordinal <= 2 ? [activation()] : [activation(), { name: 'job.list', arguments: {} }])
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => fixture.model, capabilities: async () => capabilities })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, { requestId: randomUUID(), message: 'List jobs', choice: { providerId: 'fixture', modelId: 'test' } }, () => {})
  for (let tries = 0; tries < 1000 && tasks.getRun(1, { runId: ids.runId }).run.state === 'running'; tries++) await new Promise(resolve => setTimeout(resolve, 10))
  const snapshot = tasks.getRun(1, { runId: ids.runId })
  assert.equal(snapshot.run.state, 'failed'); assert.equal(snapshot.run.error, 'AGENT_STEP_LIMIT')
  assert.equal(fixture.requests.length, 3)

  const records = f.backend.chats.listModelRequests(ids.runId, 100, 0).items
  assert.deepEqual(records.flatMap(row => row.activations.map(value => value.repeats)), [1, 2])
  assert.equal(records[2].activations[0].reason, 'activation-loop')
  assert(snapshot.items.some(item => item.state === 'failed' && item.content.type === 'tool_call' && item.content.error === 'AGENT_STEP_LIMIT'))
})
for (const sink of ['saveModelRequest', 'saveActivationDiagnostic'] as const) test(`${sink} failure ends the Run without dispatching or executing later work`, async t => {
  const f = await firstPartyFixture(t), fixture = scriptedModel(() => [activation()])
  t.mock.method(f.backend.chats, sink, () => { throw new DataError('STORAGE_UNAVAILABLE') })
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => fixture.model, capabilities: async () => capabilities })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, { requestId: randomUUID(), message: 'List jobs', choice: { providerId: 'fixture', modelId: 'test' } }, () => {})
  for (let tries = 0; tries < 1000 && tasks.getRun(1, { runId: ids.runId }).run.state === 'running'; tries++) await new Promise(resolve => setTimeout(resolve, 10))
  const snapshot = tasks.getRun(1, { runId: ids.runId })
  assert.equal(snapshot.run.state, 'failed'); assert.equal(snapshot.run.error, 'STORAGE_UNAVAILABLE')
  assert.equal(fixture.requests.length, sink === 'saveModelRequest' ? 0 : 2)
})
