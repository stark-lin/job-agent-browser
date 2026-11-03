import test from 'node:test'
import assert from 'node:assert/strict'
import { ContextBudget } from '../src/platform/agent/context/budget'
import { ContextManager } from '../src/platform/agent/context/manager'
import { ToolDiscovery } from '../src/platform/agent/tools/discovery'
import { parseCandidates } from '../src/platform/agent/memory/manager'
import { resolveAskCapabilities } from '../src/platform/ai/ask-capabilities'
import { providerTools } from '../src/platform/ai/agent-protocol'
import { resourceRecord, updateResourceRecords } from '../src/platform/agent/context/resources'
import type { AgentModel, AgentMessage, AgentToolDescriptor } from '../src/shared/agent'
import type { ContextCheckpoint } from '../src/shared/ask'
const capability = (contextWindow = 65536) => ({ contextWindow, maxOutputTokens: 8192, source: 'manual' as const, verified: true })
const live: AgentMessage[] = [{ role: 'system', content: 'Application instructions' }, { role: 'user', content: 'Current task' }]
test('model capability gates and budgets use actual limits, including windows above 128K', () => {
  assert.throws(() => new ContextBudget({ ...capability(), verified: false }, 'unknown'), { code: 'ASK_CONTEXT_UNKNOWN' })
  assert.throws(() => new ContextBudget(capability(32768), 'unknown'), { code: 'ASK_CONTEXT_TOO_SMALL' })
  assert.equal(new ContextBudget(capability(), 'unknown').input, 53248)
  assert(new ContextBudget(capability(262144), 'unknown').input > 131072)
  assert.throws(() => new ContextBudget(capability(), 'unknown').assert([{ role: 'user', content: 'x'.repeat(65536) }], []), { code: 'ASK_CONTEXT_OVERFLOW' })
})
test('incremental compaction persists a monotonic boundary only after successful summarization', async () => {
  const budget = new ContextBudget(capability(), 'unknown')
  let checkpoint: ContextCheckpoint = { summary: '', compactedThroughSequence: 0, revision: 0 }, saves = 0
  const turns = Array.from({ length: 10 }, (_, n) => ({ sequence: n + 1, messages: [{ role: 'user' as const, content: `Turn ${n}: ` + 'x'.repeat(5500) }] }))
  const model: AgentModel = { complete: async () => ({ content: 'Confirmed: preserve goal. Pending: unfinished write remains uncertain.', toolCalls: [] }) }
  const context = new ContextManager({ budget, model, checkpoint, turns, memory: '', protectedState: [], compacting() {}, save(value, revision) {
    assert.equal(revision, checkpoint.revision); assert(value.compactedThroughSequence > checkpoint.compactedThroughSequence)
    checkpoint = { ...value, revision: revision + 1 }; saves++; return checkpoint
  } })
  const result = await context.prepare(live, [], new AbortController().signal)
  assert(saves > 0); assert(budget.estimate(result, []) <= budget.input); assert.equal(turns.length, 10)
  const failing = new ContextManager({ budget, model: { complete: async () => { throw new Error('fixture') } }, checkpoint: { summary: 'old', compactedThroughSequence: 0, revision: 0 }, turns, memory: '', protectedState: [], compacting() {}, save() { throw new Error('must not save') } })
  await assert.rejects(failing.prepare(live, [], new AbortController().signal), /fixture/)
})
test('disclosure starts with two tools and refuses forbidden capabilities without changing MCP permissions', async () => {
  const descriptors: AgentToolDescriptor[] = ['job.list', 'profile.get', 'knowledge.delete', 'memory.write'].map(name => ({ name, description: name, inputSchema: { type: 'object' } }))
  const calls: string[] = [], discovery = new ToolDiscovery({ list: async () => descriptors, call: async name => { calls.push(name); return {} } }, new ContextBudget(capability(), 'unknown'))
  const signal = new AbortController().signal
  await discovery.refresh(); assert.deepEqual(discovery.loadout().map(t => t.name), ['tool.search', 'tool.activate'])
  const result = await discovery.call('tool.search', { query: 'memory' }, signal); assert.deepEqual(result, [])
  await assert.rejects(discovery.call('tool.activate', { names: ['knowledge.delete'] }, signal))
  await assert.rejects(discovery.call('job.list', {}, signal))
  await discovery.call('tool.activate', { names: ['job.list'] }, signal); discovery.loadout(); await discovery.call('job.list', {}, signal)
  assert.deepEqual(calls, ['job.list'])
  assert.equal(providerTools(descriptors.slice(0, 2), true).names.get('profile.get'), providerTools(descriptors.slice(1, 2), true).names.get('profile.get'))
})
test('memory candidates require exact user evidence and reject inferred sources and secrets', () => {
  const source = { id: 'source', text: 'I prefer VS Code.' }, candidate = { category: 'preference', content: source.text, quote: source.text, sourceMessageIds: [source.id], importance: 0.9 }
  assert.equal(parseCandidates(JSON.stringify({ candidates: [candidate] }), source).length, 1)
  for (const patch of [{ sourceMessageIds: ['assistant'] }, { quote: 'unverified' }, { content: 'api_key=sk-secretabcdefghijklmnop' }]) assert.equal(parseCandidates(JSON.stringify({ candidates: [{ ...candidate, ...patch }] }), source).length, 0)
})
test('LM Studio deployment context overrides a larger manual or theoretical model window', async () => {
  const choice = { providerId: 'local', modelId: 'model' }, settings = { providers: [{ id: 'local', name: 'Local', baseURL: 'http://127.0.0.1:1234', requiresKey: false, models: ['model'], defaultModel: 'model', capabilities: { model: capability(262144) } }], default: choice }
  const transport: typeof fetch = async () => new Response(JSON.stringify({ models: [{ key: 'model', max_context_length: 262144, loaded_instances: [{ id: 'model', config: { context_length: 32768 } }] }] }), { headers: { 'Content-Type': 'application/json' } })
  const actual = await resolveAskCapabilities(settings, choice, null, new AbortController().signal, transport)
  assert.equal(actual.contextWindow, 32768); assert.equal(actual.source, 'runtime')
  assert.throws(() => new ContextBudget(actual, 'model'), { code: 'ASK_CONTEXT_TOO_SMALL' })
})

test('resource checkpoints replace completed state while retaining uncertain writes and exact recovery paths', () => {
  const first = resourceRecord('job.get', { id: 'job' }, { id: 'job', revision: 1, description: 'PRIVATE_BODY' }, false)!
  const next = resourceRecord('job.update', { id: 'job', expectedRevision: 1 }, { id: 'job', revision: 2 }, false)!
  const records = updateResourceRecords([first], next)
  assert.equal(records.length, 1); assert(records[0].includes('"revision":2')); assert(!records[0].includes('PRIVATE_BODY'))
  const uncertain = resourceRecord('knowledge.write', { path: 'notes/topic.md', content: 'PRIVATE_NOTE', expectedRevision: 'revision' }, null, true)!
  const read = resourceRecord('knowledge.read', { path: 'notes/topic.md' }, { revision: 'new', content: 'PRIVATE_NOTE' }, false)!
  const recovered = updateResourceRecords(updateResourceRecords([], uncertain), read)
  assert.equal(recovered.length, 2); assert(recovered.some(r => r.includes('uncertain'))); assert(recovered.every(r => !r.includes('PRIVATE_NOTE')))
})
