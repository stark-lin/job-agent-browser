import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { createRunAdmission } from '../src/platform/mcp/run-admission'
import { createAdmissionBroker } from '../src/platform/mcp/run-admission-broker'
import { createExternalRun } from '../src/platform/mcp/external-run'
import { createMCPServer } from '../src/platform/mcp-server/server'
import { createJobAgentTooling, jobAgentAllowlist } from '../src/platform/tools'
import { fixture } from './helpers'
import { until } from './tool-fixtures'
import { randomUUID } from 'node:crypto'
import { parseRunGuard } from '../src/shared/agent/run-guard'

async function setup(t: import('node:test').TestContext, timeout = 15000, build?: (id: string, signal: AbortSignal) => Promise<unknown>) {
  const directory = mkdtempSync(join(tmpdir(), 'admission-')), admission = createRunAdmission(), broker = createAdmissionBroker(directory, admission, timeout)
  const f = fixture(t), tooling = createJobAgentTooling(f.backend, build ?? (async () => ({})))
  await broker.ready
  const clients: Client[] = [], servers: ReturnType<typeof createMCPServer>[] = []
  t.after(async () => { for (const client of clients) await client.close(); for (const server of servers) await server.dispose(); tooling.dispose(); await broker.close(); rmSync(directory, { recursive: true, force: true }) })
  async function client() {
    const external = createExternalRun(directory)
    const runtime = createMCPServer(tooling.registry, { allow: jobAgentAllowlist, maxRisk: 'WRITE' }, new AbortController().signal, undefined, undefined, undefined, external, () => f.backend.capabilities.settle())
    const [a, b] = InMemoryTransport.createLinkedPair(), client = new Client({ name: 'external', version: '1' })
    clients.push(client); servers.push(runtime)
    runtime.server.onclose = () => { void runtime.dispose() }
    await runtime.server.connect(b); await client.connect(a)
    return { client, runtime, external }
  }
  return { ...f, admission, broker, directory, client }
}
const call = (client: Client, name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args })
const data = (value: Awaited<ReturnType<typeof call>>) => { assert(!value.isError, JSON.stringify(value)); return value.structuredContent as Record<string, unknown> }
const denied = (value: Awaited<ReturnType<typeof call>>, code: string) => { assert(value.isError); assert.deepEqual(value.content, [{ type: 'text', text: code }]) }

test('external gateway requires server UUID, binds owner/session, preserves schemas and persists each successful write', async t => {
  const f = await setup(t), a = await f.client(), b = await f.client()
  const list = (await a.client.listTools()).tools
  assert(list.some(tool => tool.name === 'run.begin')); assert(!list.some(tool => tool.name === 'profile.freeze_baseline'))
  for (const tool of list.filter(tool => !tool.name.startsWith('run.'))) {
    assert(tool.inputSchema.required?.includes('executionRunId')); assert.equal(tool.inputSchema.additionalProperties, false)
  }
  denied(await call(a.client, 'profile.list'), 'TOOL_FORBIDDEN')
  const { runId } = data(await call(a.client, 'run.begin'))
  assert.match(String(runId), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  denied(await call(a.client, 'run.begin'), 'TOOL_BUSY')
  denied(await call(b.client, 'run.begin'), 'TOOL_BUSY')
  denied(await call(b.client, 'profile.list', { executionRunId: runId }), 'TOOL_FORBIDDEN')
  assert.throws(() => f.admission.acquire('internal'), { code: 'TOOL_BUSY' })
  const profile = data(await call(a.client, 'profile.create', { executionRunId: runId, requestId: randomUUID(), details: { title: 'Reviewed later', name: 'Person' } }))
  const item = data(await call(a.client, 'profile.add_item', { executionRunId: runId, profileId: profile.id, expectedRevision: profile.revision, requestId: randomUUID(), details: { type: 'PROJECT', title: 'Saved project' } }))
  const fact = data(await call(a.client, 'profile.add_fact', { executionRunId: runId, profileId: profile.id, expectedRevision: item.revision, requestId: randomUUID(), profileItemId: item.id, details: { kind: 'OTHER', content: 'Saved fact' } }))
  denied(await call(a.client, 'profile.add_fact', { executionRunId: runId, profileId: profile.id, expectedRevision: 1, requestId: randomUUID(), details: { kind: 'OTHER', content: 'Stale failure' } }), 'TOOL_CONFLICT')
  assert.equal(f.backend.profiles.listFacts({ profileId: profile.id }).items[0].id, fact.id)
  assert.equal(f.backend.profiles.getBaselineStatus({ profileId: profile.id }).status, 'DRAFT')
  data(await call(a.client, 'run.end', { runId })); data(await call(a.client, 'run.end', { runId }))
  denied(await call(a.client, 'profile.get', { executionRunId: runId, id: profile.id }), 'TOOL_FORBIDDEN')
  denied(await call(b.client, 'run.begin'), 'TOOL_BUSY') // Session ownership lasts beyond End.
  await a.runtime.dispose()
  const next = data(await call(b.client, 'run.begin')); assert.notEqual(next.runId, runId)
  data(await call(b.client, 'run.end', { runId: next.runId }))
  assert.equal(f.backend.profiles.listItems({ profileId: profile.id }).total, 1)
})

for (const ending of ['disconnect', 'timeout'] as const) test(`${ending} closes admission without undoing successful business writes`, async t => {
  const f = await setup(t, ending === 'timeout' ? 150 : 15000), a = await f.client()
  const { runId } = data(await call(a.client, 'run.begin'))
  const profile = data(await call(a.client, 'profile.create', { executionRunId: runId, requestId: randomUUID(), details: { name: 'Saved before close' } }))
  if (ending === 'disconnect') await a.runtime.dispose()
  await until(() => !f.admission.current())
  assert.equal(f.backend.profiles.getProfile({ id: profile.id }).name, 'Saved before close')
  if (ending === 'timeout') denied(await call(a.client, 'profile.list', { executionRunId: runId }), 'TOOL_FORBIDDEN')
  const run = f.admission.acquire('internal'); f.admission.release(run.owner, run.id)
})

test('an established control channel survives the handshake deadline during a slow tool and subsequent Runs', async t => {
  const f = await setup(t, 15000, async (_id, signal) => {
    await delay(5500, undefined, { signal })
    return { output: { status: 'READY' } }
  })
  const a = await f.client(), { runId } = data(await call(a.client, 'run.begin'))
  const result = await call(a.client, 'artifact.build', { executionRunId: runId, artifactId: randomUUID() })
  assert.deepEqual(data(result), { output: { status: 'READY' } })
  assert.equal(parseRunGuard(result._meta?.jabRunGuard)?.status, 'ACTIVE')
  assert.equal(f.admission.current()?.id, runId)
  data(await call(a.client, 'profile.list', { executionRunId: runId }))
  data(await call(a.client, 'run.end', { runId }))
  const next = data(await call(a.client, 'run.begin'))
  assert.notEqual(next.runId, runId)
  data(await call(a.client, 'run.end', { runId: next.runId }))
  assert.equal(f.admission.current(), undefined)
})

test('BLOCKED guard still accepts End; historic snapshots normalize without rewriting stored traces', async t => {
  const f = await setup(t), a = await f.client(), { runId } = data(await call(a.client, 'run.begin'))
  const profile = data(await call(a.client, 'profile.create', { executionRunId: runId, requestId: randomUUID(), details: { name: 'Kept' } }))
  for (let n = 0; n < 5; n++) await call(a.client, 'profile.list', { executionRunId: runId })
  denied(await call(a.client, 'profile.list', { executionRunId: runId }), 'TOOL_GUARD_TERMINATED')
  data(await call(a.client, 'run.end', { runId })); assert.equal(f.admission.current(), undefined)
  assert.equal(f.backend.profiles.getProfile({ id: profile.id }).name, 'Kept')
  const legacy = { agentRunId: randomUUID(), status: 'ACTIVE', calls: 1, executedCalls: 1, noProgress: 0, rejections: 0, progress: 1, executed: true, effectAlreadyConfirmed: false, effects: [] }
  const parsed = parseRunGuard(legacy)!
  assert.equal(parsed.executionRunId, legacy.agentRunId); assert(!('agentRunId' in parsed)); assert('agentRunId' in legacy)
})

test('discovery stays available without Main but Begin is unavailable', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'no-main-')), f = fixture(t), tooling = createJobAgentTooling(f.backend, async () => ({}))
  const external = createExternalRun(directory), runtime = createMCPServer(tooling.registry, { allow: jobAgentAllowlist }, new AbortController().signal, undefined, undefined, undefined, external)
  const [a, b] = InMemoryTransport.createLinkedPair(), client = new Client({ name: 'offline', version: '1' })
  t.after(async () => { await client.close(); await runtime.dispose(); tooling.dispose(); rmSync(directory, { recursive: true, force: true }) })
  await runtime.server.connect(b); await client.connect(a)
  assert((await client.listTools()).tools.length > 0)
  denied(await call(client, 'run.begin'), 'TOOL_UNAVAILABLE')
})

test('cancellation retains global occupancy until a started native operation safely settles', async t => {
  let release!: () => void, started = false, stopped = false
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await setup(t, 15000, async (_id, signal) => {
    started = true; signal.addEventListener('abort', () => { stopped = true }, { once: true })
    await gate
    return {}
  })
  const a = await f.client(), { runId } = data(await call(a.client, 'run.begin'))
  const saved = data(await call(a.client, 'profile.create', { executionRunId: runId, requestId: randomUUID(), details: { name: 'Saved before cancel' } }))
  const controller = new AbortController()
  const operation = a.client.callTool({ name: 'artifact.build', arguments: { executionRunId: runId, artifactId: randomUUID() } }, { signal: controller.signal })
  await until(() => started); controller.abort(); await assert.rejects(operation)
  await until(() => stopped)
  assert(f.admission.current()); assert.throws(() => f.admission.acquire('internal'), { code: 'TOOL_BUSY' })
  release(); await until(() => !f.admission.current())
  assert.equal(f.backend.profiles.getProfile({ id: saved.id }).name, 'Saved before cancel')
})

test('a cancelled Begin releases its acquired execution before another Run can start', async t => {
  const f = await setup(t), a = await f.client(), original = a.external.begin.bind(a.external)
  let release!: () => void, acquired = false
  const gate = new Promise<void>(resolve => { release = resolve })
  a.external.begin = async () => { const created = await original(); acquired = true; await gate; return created }
  const controller = new AbortController()
  const pending = a.client.callTool({ name: 'run.begin', arguments: {} }, { signal: controller.signal })
  await until(() => acquired); controller.abort(); await assert.rejects(pending)
  assert(f.admission.current()); release(); await until(() => !f.admission.current())
  const next = f.admission.acquire('internal'); f.admission.release(next.owner, next.id)
})

test('Main shutdown drains an external execution before releasing occupancy', async t => {
  let release!: () => void, started = false, stopped = false
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await setup(t, 15000, async (_id, signal) => {
    started = true; signal.addEventListener('abort', () => { stopped = true }, { once: true }); await gate; return {}
  })
  const a = await f.client(), { runId } = data(await call(a.client, 'run.begin'))
  const tool = call(a.client, 'artifact.build', { executionRunId: runId, artifactId: randomUUID() })
  await until(() => started)
  let closed = false
  const shutdown = f.broker.close().then(() => { closed = true })
  await until(() => stopped); assert.equal(closed, false); assert(f.admission.current())
  release(); await tool; await shutdown
  assert.equal(f.admission.current(), undefined)
  denied(await call(a.client, 'run.begin'), 'TOOL_UNAVAILABLE')
})
