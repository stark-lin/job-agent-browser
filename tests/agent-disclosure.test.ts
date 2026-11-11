import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { providerMessages, providerTools, parseAgentResponse, stableName } from '../src/platform/ai/agent-protocol'
import { fingerprint, toolSnapshot } from '../src/platform/ai/agent-request'
import { ContextBudget } from '../src/platform/agent/context/budget'
import { observeAgentModel } from '../src/platform/agent/pi/request-observer'
import { ContextManager } from '../src/platform/agent/context/manager'
import { runPiAgent } from '../src/platform/agent/pi/runtime'
import type { AgentRuntimeEvent, AgentTools, StreamingAgentModel } from '../src/shared/agent'
import { DataError } from '../src/domain/common/errors'
import { expansion, capabilities, descriptor, runDisclosure, scriptedModel, signal } from './disclosure-fixture'

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
for (const corrupt of ['missing-schema', 'changed-schema', 'wrong-alias', 'pi-state'] as const) test(`request ${corrupt} is diagnosed and blocked before transport`, async () => {
  const fixture = scriptedModel(() => 'Must not dispatch'), events: AgentRuntimeEvent[] = []
  const tools = [descriptor()], snapshot = toolSnapshot(tools)
  const observed = observeAgentModel(fixture.model, event => events.push(event))
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
  const model = observeAgentModel(fixture.model, () => { throw new DataError('STORAGE_UNAVAILABLE') })
  await assert.rejects(async () => { for await (const _event of model.stream({ messages: [], tools: [], signal: signal() })) { /* collect */ } }, /STORAGE_UNAVAILABLE/)
  await assert.rejects(model.complete({ messages: [], tools: [], signal: signal() }), /STORAGE_UNAVAILABLE/)
  assert.equal(fixture.requests.length, 0)
})
test('runtime compares Pi schemas with its own loadout before sending the next request', async () => {
  const fixture = scriptedModel((_body, round) => round === 1 ? [expansion()] : 'Must not dispatch'), events: AgentRuntimeEvent[] = []
  const model: StreamingAgentModel = { complete: input => fixture.model.complete(input), stream: input => fixture.model.stream({ ...input, tools: input.tools.filter(t => t.name !== 'job.list') }) }
  const tools: AgentTools = { list: async () => [descriptor()], call: async () => ({}) }
  await assert.rejects(runDisclosure(model, tools, e => events.push(e)), /AGENT_PROTOCOL_ERROR/)
  assert.equal(fixture.requests.length, 1)
  const requests = events.filter(e => e.type === 'model.request.prepared')
  assert.equal(requests.length, 2); assert.equal(requests[1].request.verification, 'mismatch')
})
test('context-summary and agent-turn requests share an ordinal without reinjecting diagnostics', async () => {
  const fixture = scriptedModel(body => body.stream ? 'Answer' : 'Summary'), events: AgentRuntimeEvent[] = []
  const model = observeAgentModel(fixture.model, event => events.push(event))
  const budget = new ContextBudget(capabilities, 'unknown')
  let summaries = 0
  const context = new ContextManager({ budget, model, checkpoint: { summary: '', revision: 0, compactedThroughSequence: 0 },
    turns: Array.from({ length: 10 }, (_, index) => ({ sequence: index + 1, messages: [{ role: 'user' as const, content: 'x'.repeat(5500) }] })),
    memory: '', protectedState: [], compacting() {}, save(value) { summaries++; return value } })
  await runPiAgent({ model, tools: { list: async () => [], call: async () => ({}) }, system: 'Test', message: 'Current task', budget, context, emit: event => events.push(event), signal: signal(), status() {}, protect() {} })
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
  const model = observeAgentModel(fixture.model, event => events.push(event))
  await model.complete({ messages: [], tools: [descriptor()], signal: signal() })
  const request = events.find(event => event.type === 'model.request.prepared')
  assert(request?.type === 'model.request.prepared'); assert.equal(request.request.verification, 'matched')
  assert.equal(request.request.tools[0].providerName, 'tool_0')
})

test('summary and main-loop requests share a hard budget of 64 before model dispatch', async () => {
  let complete = 0, streamed = 0
  const model = observeAgentModel({ complete: async () => { complete++; return { content: 'summary', toolCalls: [] } }, async *stream() {
    streamed++; yield { type: 'completed', response: { content: 'answer', toolCalls: [] } }
  } }, () => {})
  const input = { messages: [], tools: [], signal: signal() }
  for (let i = 0; i < 16; i++) await model.complete(input)
  for (let i = 0; i < 48; i++) for await (const _event of model.stream(input)) { /* Consume actual requests. */ }
  assert.throws(() => model.stream(input), /AGENT_STEP_LIMIT/)
  assert.throws(() => model.complete(input), /AGENT_STEP_LIMIT/)
  assert.equal(complete, 16); assert.equal(streamed, 48)
})
