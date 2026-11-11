import { withPreparation } from './ask-fixture'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { firstPartyFixture } from './first-party-fixture'
import { expansion, capabilities, reply, scriptedModel, type WireRequest } from './disclosure-fixture'
import { DataError } from '../src/domain/common/errors'
import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import { compatibleAgentModel } from '../src/platform/ai/agent-model'
import { stableName } from '../src/platform/ai/agent-protocol'
import { fingerprint } from '../src/platform/ai/agent-request'

test('real HTTP and first-party MCP expand Scope, execute and answer without automatic fixture activation', async t => {
  const f = await firstPartyFixture(t), requests: WireRequest[] = []
  let authorizedSchema: Record<string, unknown> | undefined
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', chunk => { raw += chunk })
    request.on('end', async () => {
      const body = JSON.parse(raw) as WireRequest, ordinal = requests.push(body)
      assert.equal(request.url, '/v1/chat/completions')
      const business = body.tools.find(tool => tool.function.name === stableName('job.list'))
      if (ordinal === 1) {
        assert.equal(business, undefined)
        assert(body.tools.every(tool => tool.function.description.startsWith('[scope.') || tool.function.description.startsWith('[human.ask]')))
      } else {
        assert(business); assert.deepEqual(business.function.parameters, authorizedSchema)
      }
      if (ordinal === 2) {
        assert(JSON.parse(body.messages.at(-1)!.content).tools.some((entry: { name: string }) => entry.name === 'job.list'))
        const history = body.messages.filter(message => message.role === 'assistant').flatMap(message => message.tool_calls ?? [])
        assert.deepEqual(history.map(call => call.function.name), [stableName('scope.job')])
      }
      if (ordinal === 3) {
        const result = JSON.parse(body.messages.at(-1)!.content)
        assert.equal(result.total, 1); assert.equal(result.items[0].id, f.job.id)
      }
      const calls = ordinal === 1 ? [expansion()] : ordinal === 2 ? [{ name: 'job.list', arguments: {} }] : 'Saved job found.'
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(await reply(calls, ordinal).text())
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const model = compatibleAgentModel({ provider: { id: 'fixture', name: 'Fixture', baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, models: ['test'] }, model: 'test', key: null }, {  })
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => withPreparation(model), capabilities: async () => capabilities })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, { requestId: randomUUID(), message: 'Find my saved jobs', choice: { providerId: 'fixture', modelId: 'test' } }, () => {})
  const tools = await f.mcp.session('ask-ai', new AbortController().signal, ids.sessionId)
  authorizedSchema = (await tools.list()).find(tool => tool.name === 'job.list')!.inputSchema
  for (let tries = 0; tries < 1000 && tasks.getRun(1, { runId: ids.runId }).run.state === 'running'; tries++) await new Promise(resolve => setTimeout(resolve, 10))
  const snapshot = tasks.getRun(1, { runId: ids.runId })
  assert.equal(snapshot.run.state, 'completed', snapshot.run.error ?? '')
  assert.equal(requests.length, 3)
  assert(snapshot.items.some(item => item.content.type === 'assistant_message' && item.content.text === 'Saved job found.'))

  const diagnostics = f.backend.chats.listModelRequests(ids.runId, 100, 0)
  assert.equal(diagnostics.total, 4)
  assert.equal(diagnostics.items[0].phase, 'prepare')
  for (const [index, row] of diagnostics.items.slice(1).entries()) {
    assert.equal(row.ordinal, index + 2); assert.equal(row.verification, 'matched'); assert.equal(row.purpose, 'agent-turn')
    const sorted = (tools: typeof row.tools) => [...tools].sort((a, b) => a.name.localeCompare(b.name))
    assert.deepEqual(sorted(row.expectedTools), sorted(row.piTools)); assert.deepEqual(sorted(row.expectedTools), sorted(row.tools))
    assert.deepEqual(row.tools.map(tool => tool.providerName), requests[index].tools.map(tool => tool.function.name))
    assert.deepEqual(row.tools.map(tool => tool.schemaHash), requests[index].tools.map(tool => fingerprint(tool.function.parameters)))
  }
  f.backend.chats.deleteSession(ids.sessionId)
  assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM agent_model_requests WHERE run_id=?').get(ids.runId)?.n, 0)
  assert.equal(f.backend.jobs.getJob({ id: f.job.id }).id, f.job.id)
})
test('Ask Profile discovery and model requests expose only read interfaces', async t => {
  const f = await firstPartyFixture(t)
  const expected = ['profile.get', 'profile.list', 'profile.list_facts', 'profile.list_items']
  const hidden = /profile\.(?:create|update|add_item|update_item|add_fact|update_fact)\b|resume\.[a-z_]+|artifact\.build|Tailor Resume/
  const fixture = scriptedModel((request, ordinal) => {
    assert.doesNotMatch(JSON.stringify(request), hidden)
    if (ordinal === 1) return [{ name: 'scope.profile', arguments: {} }]
    assert.deepEqual(request.tools.filter(tool => tool.function.description.startsWith('[profile.'))
      .map(tool => /^\[([^\]]+)\]/.exec(tool.function.description)![1]).sort(), expected)
    if (ordinal === 2) {
      const directory = JSON.parse(request.messages.at(-1)!.content) as { tools: { name: string }[] }
      assert.deepEqual(directory.tools.map(tool => tool.name).sort(), expected)
      return [{ name: 'profile.list', arguments: {} }]
    }
    return 'I can read saved profiles.'
  })
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => withPreparation(fixture.model), capabilities: async () => capabilities })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, { requestId: randomUUID(), message: 'What profile tools can you use?', choice: { providerId: 'fixture', modelId: 'test' } }, () => {})
  for (let tries = 0; tries < 1000 && tasks.getRun(1, { runId: ids.runId }).run.state === 'running'; tries++) await new Promise(resolve => setTimeout(resolve, 10))
  const snapshot = tasks.getRun(1, { runId: ids.runId })
  assert.equal(snapshot.run.state, 'completed', snapshot.run.error ?? '')
  assert.equal(snapshot.run.writeStarted, false)
  assert.equal(fixture.requests.length, 3)
})

test('repeated Scopes keep the Run alive without producing activation diagnostics', async t => {
  const f = await firstPartyFixture(t), fixture = scriptedModel((_body, ordinal) => ordinal <= 3 ? [expansion()] : 'Done')
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => withPreparation(fixture.model), capabilities: async () => capabilities })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, { requestId: randomUUID(), message: 'List jobs', choice: { providerId: 'fixture', modelId: 'test' } }, () => {})
  for (let tries = 0; tries < 1000 && tasks.getRun(1, { runId: ids.runId }).run.state === 'running'; tries++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(tasks.getRun(1, { runId: ids.runId }).run.state, 'completed')
  assert(f.backend.chats.listModelRequests(ids.runId, 100, 0).items.every(row => row.activations.length === 0))
})
for (const sink of ['saveModelRequest'] as const) test(`${sink} failure ends the Run without dispatching or executing later work`, async t => {
  const f = await firstPartyFixture(t), fixture = scriptedModel(() => [expansion()])
  t.mock.method(f.backend.chats, sink, () => { throw new DataError('STORAGE_UNAVAILABLE') })
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => withPreparation(fixture.model), capabilities: async () => capabilities })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, { requestId: randomUUID(), message: 'List jobs', choice: { providerId: 'fixture', modelId: 'test' } }, () => {})
  for (let tries = 0; tries < 1000 && tasks.getRun(1, { runId: ids.runId }).run.state === 'running'; tries++) await new Promise(resolve => setTimeout(resolve, 10))
  const snapshot = tasks.getRun(1, { runId: ids.runId })
  assert.equal(snapshot.run.state, 'failed'); assert.equal(snapshot.run.error, 'STORAGE_UNAVAILABLE')
  assert.equal(fixture.requests.length, 0)
})
