import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { providerMessages, providerTools, parseAgentResponse, stableName } from '../src/platform/ai/agent-protocol'
import { fingerprint, toolSnapshot } from '../src/platform/ai/agent-request'
import { ToolDiscovery } from '../src/platform/agent/tools/discovery'
import { ContextBudget } from '../src/platform/agent/context/budget'
import { observeAskModel } from '../src/platform/agent/pi/request-observer'
import { ContextManager } from '../src/platform/agent/context/manager'
import { runPiAsk } from '../src/platform/agent/pi/runtime'
import type { AgentRuntimeEvent, AgentTools, StreamingAgentModel } from '../src/shared/agent'
import { DataError } from '../src/domain/common/errors'
import { activation, capabilities, descriptor, runDisclosure, scriptedModel, signal } from './disclosure-fixture'

test('semantic provider names are bounded, punctuation-safe, stable across loadouts, and restore historical calls', () => {
  const tools = ['job.list', 'job_list', 'job-list', '中文.😀', 'a'.repeat(90) + '.first', 'a'.repeat(90) + '.last'].map(descriptor)
  const mapped = providerTools(tools, true)
  assert.equal(new Set(mapped.names.values()).size, tools.length)
  for (const tool of tools) {
    const alias = mapped.names.get(tool.name)!
    assert.match(alias, /^[a-zA-Z0-9_-]{1,64}$/)
    assert.equal(alias, providerTools([...tools].reverse(), true).names.get(tool.name))
    assert.equal(alias, providerTools([tool], true).names.get(tool.name))
  }
  assert.match(mapped.names.get('job.list')!, /^tool_job_list_[a-f0-9]{10}$/)
  assert.equal(mapped.tools[0].function.description, '[job.list] Describe job.list')
  const history = providerMessages([{ role: 'assistant', content: '', toolCalls: [{ id: 'old', name: 'job.list', arguments: {} }] }], providerTools([descriptor('other')], true).names, true)
  assert.equal((history[0] as { tool_calls: { function: { name: string } }[] }).tool_calls[0].function.name, stableName('job.list'))
  const response = parseAgentResponse({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 'new', type: 'function', function: { name: stableName('job.list'), arguments: '{}' } }] } }] }, mapped.names)
  assert.equal(response.toolCalls[0].name, 'job.list')
  assert.equal(providerTools(tools).tools[0].function.description, tools[0].description)
  assert.equal(providerTools(tools).names.get('job.list'), 'tool_0')
  assert.equal(fingerprint({ b: { d: 1, c: 2 }, a: 3 }), fingerprint({ a: 3, b: { c: 2, d: 1 } }))
})
test('provider alias collisions and duplicate logical names are rejected', t => {
  assert.throws(() => providerTools([descriptor(), descriptor()], true), /AGENT_PROTOCOL_ERROR/)
  t.mock.method(crypto, 'createHash', () => ({ update() { return this }, digest() { return '0'.repeat(64) } }) as unknown as ReturnType<typeof crypto.createHash>)
  assert.throws(() => providerTools([descriptor('job.list'), descriptor('job_list')], true), /AGENT_PROTOCOL_ERROR/)
})
test('only verified requests count duplicates; normalization, search, business progress and mixed activation behave correctly', async () => {
  const tools = { list: async () => ['job.list', 'profile.get'].map(descriptor), call: async () => ({ total: 1 }) }
  const registry = new ToolDiscovery(tools, new ContextBudget(capabilities, 'fixture'))
  await registry.refresh(); registry.loadout()
  const activate = (names: string[]) => registry.call('tool.activate', { names }, signal())
  assert.equal((await activate(['job.list']) as { changed: boolean }).changed, true)
  assert.equal((await activate(['job.list']) as { changed: boolean }).changed, false)
  registry.loadout()
  // An executable loadout alone does not prove that a provider request advertised it.
  await activate(['job.list']); await activate(['job.list'])
  registry.confirmRequest(['job.list'])
  const duplicate = await activate(['job.list', 'job.list']) as { alreadyActive: string[]; changed: boolean; nextAction: string }
  assert.deepEqual(duplicate.alreadyActive, ['job.list']); assert.equal(duplicate.changed, false); assert.match(duplicate.nextAction, /directly/)
  await registry.call('tool.search', { query: 'job' }, signal())
  await assert.rejects(activate(['job.list']), /AGENT_STEP_LIMIT/)
  await registry.call('job.list', {}, signal())
  await activate(['job.list'])
  assert.equal((await activate(['profile.get', 'job.list']) as { changed: boolean }).changed, true)
  registry.loadout(); registry.confirmRequest(['job.list', 'profile.get'])
  await activate(['profile.get', 'job.list', 'job.list'])
  await assert.rejects(activate(['job.list', 'profile.get']), /AGENT_STEP_LIMIT/)
})
test('catalog changes and eviction permit fresh activation without false loops', async () => {
  let catalog = Array.from({ length: 10 }, (_, i) => descriptor(`job.${i}`))
  const registry = new ToolDiscovery({ list: async () => catalog, call: async () => ({}) }, new ContextBudget(capabilities, 'fixture'))
  await registry.refresh(); registry.loadout()
  const activate = (names: string[]) => registry.call('tool.activate', { names }, signal())
  await activate(catalog.slice(0, 8).map(t => t.name)); registry.loadout(); registry.confirmRequest(catalog.map(t => t.name))
  await activate(['job.0'])
  await activate(['job.8']); registry.loadout()
  assert(!registry.snapshot().tools.some(t => t.name === 'job.0'))
  assert.equal((await activate(['job.0']) as { changed: boolean }).changed, true)
  registry.loadout(); registry.confirmRequest(['job.0']); await activate(['job.0'])
  catalog = catalog.filter(t => t.name !== 'job.0'); await registry.refresh()
  await assert.rejects(activate(['job.0']), /AGENT_PROTOCOL_ERROR/)
  catalog = [...catalog, descriptor('job.0')]; await registry.refresh()
  assert.equal((await activate(['job.0']) as { changed: boolean }).changed, true)
  registry.loadout(); registry.confirmRequest(['job.0']); await activate(['job.0'])
  catalog = catalog.map(t => t.name === 'job.0' ? { ...t, inputSchema: { type: 'object', required: ['new'] } } : t)
  await activate(['job.0']); registry.loadout(); registry.confirmRequest(['job.0']); await activate(['job.0'])
})
for (const recover of [true, false]) test(`runtime ${recover ? 'recovers after one duplicate' : 'stops a repeated activation before later tools or inference'}`, async () => {
  const events: AgentRuntimeEvent[] = [], calls: string[] = []
  const fixture = scriptedModel((_body, round) => round === 1 || round === 2 ? [activation()]
    : round === 3 ? recover ? [{ name: 'job.list', arguments: {} }] : [activation(), { name: 'job.list', arguments: {} }]
    : 'Done')
  const run = runDisclosure(fixture.model, { list: async () => [descriptor()], call: async name => { calls.push(name); return { total: 1 } } }, e => events.push(e))
  if (recover) { await run; assert.deepEqual(calls, ['job.list']); assert.equal(fixture.requests.length, 4) }
  else { await assert.rejects(run, /AGENT_STEP_LIMIT/); assert.deepEqual(calls, []); assert.equal(fixture.requests.length, 3) }
  const repeats = events.filter(e => e.type === 'model.request.activation').map(e => e.activation.repeats)
  assert.deepEqual(repeats, recover ? [1] : [1, 2])
  assert.equal(events.filter(e => e.type === 'model.request.prepared').length, fixture.requests.length)
})
test('multiple pending activations in one batch are not mistaken for advertised tools', async () => {
  const events: AgentRuntimeEvent[] = []
  const fixture = scriptedModel((_body, round) => round === 1 ? [activation(), activation(), activation()] : round === 2 ? [{ name: 'job.list', arguments: {} }] : 'Done')
  await runDisclosure(fixture.model, { list: async () => [descriptor()], call: async () => ({}) }, e => events.push(e))
  assert(!events.some(e => e.type === 'model.request.activation'))
})
for (const corrupt of ['missing-schema', 'changed-schema', 'wrong-alias', 'pi-state'] as const) test(`request ${corrupt} is diagnosed and blocked before transport`, async () => {
  const fixture = scriptedModel(() => 'Must not dispatch'), events: AgentRuntimeEvent[] = []
  const tools = [descriptor()], snapshot = toolSnapshot(tools)
  const observed = observeAskModel(fixture.model, event => events.push(event))
  const expectedTools = corrupt === 'wrong-alias' ? snapshot.map(t => ({ ...t, providerName: 'wrong' })) : snapshot
  const piTools = corrupt === 'pi-state' ? [] : expectedTools
  const actualTools = corrupt === 'missing-schema' ? [] : corrupt === 'changed-schema' ? [{ ...tools[0], inputSchema: { type: 'object' } }] : tools
  await assert.rejects(async () => {
    for await (const _event of observed.stream({ messages: [], tools: actualTools, stableToolNames: true, signal: signal(),
      requestContext: { purpose: 'agent-turn', loadoutVersion: 1, expectedTools, piTools } })) { /* collect */ }
  }, /AGENT_PROTOCOL_ERROR/)
  assert.equal(fixture.requests.length, 0)
  const request = events.find(e => e.type === 'model.request.prepared')
  assert(request?.type === 'model.request.prepared'); assert.equal(request.request.verification, 'mismatch')
})
test('diagnostic persistence failure blocks streaming and summary transport', async () => {
  const fixture = scriptedModel(() => 'Must not dispatch')
  const model = observeAskModel(fixture.model, () => { throw new DataError('STORAGE_UNAVAILABLE') })
  await assert.rejects(async () => { for await (const _event of model.stream({ messages: [], tools: [], signal: signal() })) { /* collect */ } }, /STORAGE_UNAVAILABLE/)
  await assert.rejects(model.complete({ messages: [], tools: [], signal: signal() }), /STORAGE_UNAVAILABLE/)
  assert.equal(fixture.requests.length, 0)
})
test('runtime compares Pi schemas with its own loadout before sending the next request', async () => {
  const fixture = scriptedModel((_body, round) => round === 1 ? [activation()] : 'Must not dispatch'), events: AgentRuntimeEvent[] = []
  const model: StreamingAgentModel = { complete: input => fixture.model.complete(input), stream: input => fixture.model.stream({ ...input, tools: input.tools.filter(t => t.name !== 'job.list') }) }
  const tools: AgentTools = { list: async () => [descriptor()], call: async () => { assert.fail('No business calls') } }
  await assert.rejects(runDisclosure(model, tools, e => events.push(e)), /AGENT_PROTOCOL_ERROR/)
  assert.equal(fixture.requests.length, 1)
  const requests = events.filter(e => e.type === 'model.request.prepared')
  assert.equal(requests.length, 2); assert.equal(requests[1].request.verification, 'mismatch')
})
test('context-summary and agent-turn requests share an ordinal without reinjecting diagnostics', async () => {
  const fixture = scriptedModel(body => body.stream ? 'Answer' : 'Summary'), events: AgentRuntimeEvent[] = []
  const model = observeAskModel(fixture.model, event => events.push(event))
  const budget = new ContextBudget(capabilities, 'unknown')
  let summaries = 0
  const context = new ContextManager({ budget, model, checkpoint: { summary: '', revision: 0, compactedThroughSequence: 0 },
    turns: Array.from({ length: 10 }, (_, index) => ({ sequence: index + 1, messages: [{ role: 'user' as const, content: 'x'.repeat(5500) }] })),
    memory: '', protectedState: [], compacting() {}, save(value) { summaries++; return value } })
  await runPiAsk({ model, tools: { list: async () => [], call: async () => ({}) }, system: 'Test', message: 'Current task', budget, context, emit: event => events.push(event), signal: signal(), status() {}, protect() {} })
  assert(summaries > 0)
  const requests = events.filter(event => event.type === 'model.request.prepared').map(event => event.request)
  assert.deepEqual(requests.map(row => row.ordinal), requests.map((_row, index) => index + 1))
  assert(requests.slice(0, -1).every(row => row.purpose === 'context-summary' && !row.tools.length))
  assert.equal(requests.at(-1)?.purpose, 'agent-turn')
  assert.equal(requests.length, fixture.requests.length)
  assert(!JSON.stringify(fixture.requests).includes('schemaHash'))
})
test('request observation preserves the default index mapping for callers without stable names', async () => {
  const fixture = scriptedModel(() => 'Summary'), events: AgentRuntimeEvent[] = []
  const model = observeAskModel(fixture.model, event => events.push(event))
  await model.complete({ messages: [], tools: [descriptor()], signal: signal() })
  const request = events.find(event => event.type === 'model.request.prepared')
  assert(request?.type === 'model.request.prepared'); assert.equal(request.request.verification, 'matched')
  assert.equal(request.request.tools[0].providerName, 'tool_0')
})
