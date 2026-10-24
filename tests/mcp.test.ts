import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMCPClient } from '../src/platform/mcp/client'
import { createMCPClientPool } from '../src/platform/mcp/client-pool'
import { createMCPProvider } from '../src/platform/mcp/provider'
import { createToolRuntime } from '../src/platform/mcp/runtime'
import { parseMCPConfiguration } from '../src/platform/mcp/server-config'
import { adaptMCPResult, schemaFingerprint } from '../src/platform/mcp/tool-adapter'
import { readMCPConfiguration } from '../src/platform/storage/mcp-config'
import { createAuditedCapabilities } from '../src/platform/tools/capabilities'
import { fixture } from './helpers'
import { caller, serverConfig, until } from './tool-fixtures'

test('configuration is versioned, explicit and Main-only; missing/corrupt files never launch processes or reset data', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-config-')), path = join(dir, 'mcp.json')
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.deepEqual(readMCPConfiguration(path), { version: 1, servers: [] })
  writeFileSync(path, 'PRIVATE_BROKEN_CONFIG')
  assert.throws(() => readMCPConfiguration(path), { code: 'TOOL_INVALID_CONFIG' })
  assert.equal(readFileSync(path, 'utf8'), 'PRIVATE_BROKEN_CONFIG')
  const valid = serverConfig()
  for (const config of [{ ...valid, command: 'npx' }, { ...valid, transport: 'http' }, { ...valid, env: { TOKEN: 'PRIVATE' } },
    { ...valid, tools: valid.tools.map(tool => ({ ...tool, risk: 'WRITE' })) }, { ...valid, tools: valid.tools.map(tool => ({ ...tool, name: 'job.get' })) }]) {
    assert.throws(() => parseMCPConfiguration({ version: 1, servers: [config] }), { code: 'TOOL_INVALID_CONFIG' })
  }
  assert.throws(() => parseMCPConfiguration({ version: 1, servers: [valid, valid] }), { code: 'TOOL_INVALID_CONFIG' })
})

test('provider enforces reviewed names and schemas, ignores upstream hints/descriptions, and preserves provenance', async t => {
  const f = fixture(t), config = serverConfig(), unknown = { name: 'delete_everything', description: 'untrusted', inputSchema: config.tools[0].inputSchema }
  const client = { connect: async () => {}, close: async () => {}, listTools: async () => [unknown, { name: 'echo', description: '', inputSchema: config.tools[0].inputSchema }],
    callTool: async () => ({ content: [{ type: 'text', text: 'accepted' }] }) }
  const result = await createMCPProvider(config, client, f.backend.capabilities).discover()
  assert.deepEqual(result.tools.map(tool => tool.descriptor.name), ['fixture.echo'])
  assert.deepEqual(result.tools[0].descriptor.source, { type: 'mcp', serverId: 'fixture', originalName: 'echo' })
  assert.equal(result.tools[0].descriptor.description, 'Reviewed echo.')
  const changed = { ...client, listTools: async () => [{ name: 'echo', description: '', inputSchema: { ...config.tools[0].inputSchema, additionalProperties: true } }] }
  const denied = await createMCPProvider(config, changed, f.backend.capabilities).discover()
  assert.deepEqual(denied.tools, [])
  assert.equal(denied.rejected[0].error, 'MCP_INVALID_RESPONSE')
  const duplicate = { ...client, listTools: async () => [unknown, unknown] }
  await assert.rejects(createMCPProvider(config, duplicate, f.backend.capabilities).discover(), { code: 'MCP_INVALID_RESPONSE' })
  assert.equal(schemaFingerprint({ type: 'object', properties: {} }), schemaFingerprint({ properties: {}, type: 'object' }))
})

test('result adapter separates tool errors, malformed responses and unsupported content without exposing bodies', () => {
  assert.deepEqual(adaptMCPResult({ content: [{ type: 'text', text: 'hello', annotations: { audience: ['user'] } }], structuredContent: { value: 1 } }),
    { content: [{ type: 'text', text: 'hello' }], structuredContent: { value: 1 } })
  assert.throws(() => adaptMCPResult({ isError: true, content: [{ type: 'text', text: 'PRIVATE_ERROR_BODY' }] }), { message: 'TOOL_EXECUTION_FAILED' })
  assert.throws(() => adaptMCPResult({ resultType: 'input_required', inputRequests: {} }), { code: 'TOOL_UNSUPPORTED' })
  assert.throws(() => adaptMCPResult({ content: [{ type: 'resource_link', uri: 'secret://private' }] }), { code: 'TOOL_UNSUPPORTED' })
  assert.throws(() => adaptMCPResult({}), { code: 'MCP_INVALID_RESPONSE' })
})

test('client pool deduplicates connections, rejects conflicting IDs and cancels a pending connection on disposal', async () => {
  let connections = 0, closes = 0
  const pool = createMCPClientPool({ closed() {}, changed() {} }, () => ({
    async connect(signal) { connections++; await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), { once: true })) },
    async listTools() { return [] }, async callTool() { return {} }, async close() { closes++ }
  }))
  const config = serverConfig(), first = pool.connect(config), rejection = assert.rejects(first, { code: 'TOOL_CANCELLED' })
  assert.equal(pool.connect(config), first)
  assert.throws(() => pool.connect({ ...config, args: [] }), { code: 'TOOL_CONFLICT' })
  assert.equal(connections, 1)
  await pool.dispose(); await rejection
  assert.equal(closes >= 1, true)
  assert.throws(() => pool.get(config.id), { code: 'TOOL_UNAVAILABLE' })
})

test('real stdio discovers every page, calls tools, isolates cancellation, excludes secrets and cleans its process', async t => {
  const config = serverConfig(), controller = new AbortController()
  let closed = 0
  const client = createMCPClient(config, { closed() { closed++ }, changed() {} })
  t.after(() => client.close())
  process.env.MCP_TEST_PRIVATE_TOKEN = 'PRIVATE_ENV_TOKEN'
  t.after(() => { delete process.env.MCP_TEST_PRIVATE_TOKEN })
  await client.connect()
  assert.equal((await client.listTools()).some(tool => tool.name === 'delete_everything'), true)
  const first = adaptMCPResult(await client.callTool('echo', { text: 'PRIVATE_INPUT' }, controller.signal))
  const pid = (first.structuredContent as { pid: number }).pid
  const environment = adaptMCPResult(await client.callTool('environment', { text: '' }, controller.signal))
  assert.deepEqual(environment.structuredContent, { secretInherited: false, electronNode: true })
  const cancel = new AbortController(), pending = client.callTool('slow', { text: 'slow' }, cancel.signal)
  const stopped = assert.rejects(pending, { code: 'TOOL_CANCELLED' })
  cancel.abort(); await stopped
  const second = adaptMCPResult(await client.callTool('echo', { text: 'still alive' }, controller.signal))
  assert.equal((second.structuredContent as { text: string }).text, 'still alive')
  await client.close()
  await until(() => { try { process.kill(pid, 0); return false } catch { return true } }, 'MCP child survived disposal')
  assert.equal(closed, 1)
  await assert.rejects(client.callTool('echo', { text: '' }, controller.signal), { code: 'TOOL_UNAVAILABLE' })
})

test('real connection failure and stalled handshake use stable, bounded errors', async t => {
  const config = serverConfig(), bad = createMCPClient({ ...config, command: '/definitely-missing-job-mcp-server' }, { closed() {}, changed() {} })
  t.after(() => bad.close())
  await assert.rejects(bad.connect(), { code: 'MCP_CONNECT_FAILED' })
  const stalled = createMCPClient({ ...config, args: [...config.args, '--silent'] }, { closed() {}, changed() {} }, { connectMs: 50 })
  t.after(() => stalled.close())
  await assert.rejects(stalled.connect(), { code: 'TOOL_TIMEOUT' })
})

test('runtime revokes changed tools and stale scopes, never accepts new tools, handles crash and forbids high risks', async t => {
  const f = fixture(t), config = serverConfig(['echo', 'slow', 'change', 'restore', 'crash', 'fail', 'image', 'large'])
  const runtime = createToolRuntime({ configuration: () => ({ version: 1, servers: [config] }), capabilities: f.backend.capabilities,
    native: f.backend.toolCapabilities.read, recoverAudit: f.backend.toolAudit.recoverInterrupted })
  t.after(() => runtime.dispose())
  await runtime.start()
  assert.equal(runtime.status().servers[0].state, 'ready')
  const scope = runtime.scope({ allow: ['fixture.*'] }, caller())
  assert.equal(scope.get('fixture.delete_everything'), null)
  for (const [name, code] of [['fail', 'TOOL_EXECUTION_FAILED'], ['image', 'TOOL_UNSUPPORTED'], ['large', 'MCP_INVALID_RESPONSE']]) {
    await assert.rejects(scope.execute(`fixture.${name}`, { text: 'PRIVATE_INPUT' }), { code })
  }
  await scope.execute('fixture.change', { text: '' })
  await until(() => runtime.status().servers[0].state === 'degraded', 'Changed schema did not quarantine tool')
  assert.deepEqual(scope.list(), [])
  const refreshed = runtime.scope({ allow: ['fixture.*'] }, caller())
  assert.equal(refreshed.get('fixture.echo'), null)
  assert.equal(refreshed.get('fixture.slow'), null)
  assert.equal(refreshed.get('fixture.new_danger'), null)
  await refreshed.execute('fixture.restore', { text: '' })
  await until(() => runtime.status().servers[0].state === 'ready')
  assert.equal(scope.get('fixture.echo'), null)
  const restored = runtime.scope({ allow: ['fixture.*'] }, caller())
  assert.notEqual(restored.get('fixture.echo'), null)
  assert.throws(() => runtime.scope({ allow: ['fixture.*'], maxRisk: 'WRITE' }, caller()), { code: 'TOOL_FORBIDDEN' })
  await assert.rejects(restored.execute('fixture.crash', { text: '' }), { code: 'TOOL_UNAVAILABLE' })
  await until(() => runtime.status().servers[0].state === 'disconnected')
  assert.deepEqual(restored.list(), [])
  const records = JSON.stringify(f.backend.toolAudit.list())
  for (const privateValue of ['PRIVATE_INPUT', 'PRIVATE_SERVER_ERROR_TOKEN', 'UNTRUSTED_UPSTREAM_DESCRIPTION']) assert.equal(records.includes(privateValue), false)
})

test('runtime startup isolates optional configuration failures and disposal cancels calls that ignore signals', async t => {
  const f = fixture(t), runtime = createToolRuntime({ configuration() { throw new Error('PRIVATE_CONFIG_PATH') }, capabilities: f.backend.capabilities,
    native: f.backend.toolCapabilities.read, recoverAudit: f.backend.toolAudit.recoverInterrupted })
  await runtime.start()
  assert.notEqual(runtime.status().configurationError, null)
  assert.equal(JSON.stringify(runtime.status()).includes('PRIVATE_CONFIG_PATH'), false)
  assert.equal(runtime.scope({ allow: ['job.*'] }, caller()).list().length, 2)
  await runtime.dispose()
  assert.throws(() => runtime.scope({ allow: [] }, caller()), { code: 'TOOL_UNAVAILABLE' })
})

test('runtime timeout is audited and does not close the shared stdio connection', async t => {
  const f = fixture(t), config = serverConfig(['slow', 'echo']), capabilities = createAuditedCapabilities(f.backend.toolAudit.sink, { timeoutMs: 25 })
  const runtime = createToolRuntime({ configuration: () => ({ version: 1, servers: [config] }), capabilities, native: [], recoverAudit() {} })
  t.after(() => runtime.dispose())
  await runtime.start()
  const scope = runtime.scope({ allow: ['fixture.*'] }, caller())
  await assert.rejects(scope.execute('fixture.slow', { text: 'private' }), { code: 'TOOL_TIMEOUT' })
  const result = await scope.execute('fixture.echo', { text: 'still alive' })
  assert.equal((result.structuredContent as { text: string }).text, 'still alive')
  assert.deepEqual(f.backend.toolAudit.list().filter(row => row.phase === 'END').map(row => row.status), ['FAILURE', 'SUCCESS'])
})

test('optional Server startup failure retains its connection error while Native tools stay usable', async t => {
  const f = fixture(t), config = { ...serverConfig(), command: '/missing-job-mcp-executable' }
  const runtime = createToolRuntime({ configuration: () => ({ version: 1, servers: [config] }), capabilities: f.backend.capabilities,
    native: f.backend.toolCapabilities.read, recoverAudit: f.backend.toolAudit.recoverInterrupted })
  t.after(() => runtime.dispose())
  await runtime.start()
  assert.equal(runtime.status().servers[0].state, 'disconnected')
  assert.equal(runtime.status().servers[0].error, 'MCP_CONNECT_FAILED')
  assert.equal(runtime.scope({ allow: ['job.*'] }, caller()).list().length, 2)
})

test('discovery has a total deadline and bounded pagination even for a non-converging Server', async t => {
  for (const flag of ['--slow-list', '--endless']) {
    const config = serverConfig(), client = createMCPClient({ ...config, args: [...config.args, flag] }, { closed() {}, changed() {} }, { discoveryMs: flag === '--slow-list' ? 20 : 1000 })
    t.after(() => client.close())
    await client.connect()
    await assert.rejects(client.listTools(), { code: flag === '--slow-list' ? 'TOOL_TIMEOUT' : 'MCP_INVALID_RESPONSE' })
    await client.close()
  }
})

test('per-Server concurrency rejects excess work without closing the connection', async t => {
  const client = createMCPClient(serverConfig(), { closed() {}, changed() {} }), controller = new AbortController()
  t.after(() => client.close())
  await client.connect()
  const pending = Array.from({ length: 4 }, () => client.callTool('slow', { text: 'private' }, controller.signal))
  const settled = Promise.all(pending.map(call => assert.rejects(call, { code: 'TOOL_CANCELLED' })))
  await assert.rejects(client.callTool('slow', { text: 'private' }, controller.signal), { code: 'TOOL_BUSY' })
  controller.abort(); await settled
  assert.equal(adaptMCPResult(await client.callTool('echo', { text: 'alive' }, new AbortController().signal)).content[0].text, 'alive')
})
