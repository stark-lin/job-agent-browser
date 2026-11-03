import test from 'node:test'
import assert from 'node:assert/strict'
import { ContextBudget } from '../src/platform/agent/context/budget'
import { ContextManager } from '../src/platform/agent/context/manager'
import { ToolDiscovery } from '../src/platform/agent/tools/discovery'
import { loadCoreMemory } from '../src/platform/agent/context/core-memory'
import { ToolError } from '../src/shared/tools/errors'
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
  const result = await discovery.call('tool.search', { query: 'memory' }, signal) as { name: string }[]; assert.deepEqual(result.map(t => t.name), ['memory.write'])
  await assert.rejects(discovery.call('tool.activate', { names: ['knowledge.delete'] }, signal))
  await assert.rejects(discovery.call('job.list', {}, signal))
  await discovery.call('tool.activate', { names: ['job.list'] }, signal); discovery.loadout(); await discovery.call('job.list', {}, signal)
  assert.deepEqual(calls, ['job.list'])
  assert.equal(providerTools(descriptors.slice(0, 2), true).names.get('profile.get'), providerTools(descriptors.slice(1, 2), true).names.get('profile.get'))
})
test('Core uses a local bounded Unicode view, never recalls or writes, and only ignores missing files', async () => {
  const budget = new ContextBudget(capability(), 'unknown'), signal = new AbortController().signal
  let content = 'I prefer short answers.', calls = 0
  const tools = { list: async () => [], call: async (name: string, args: unknown) => {
    assert.equal(name, 'memory.read'); assert.deepEqual(args, { path: 'CORE.md' }); calls++; return { content }
  } }
  assert((await loadCoreMemory(tools, budget, signal)).includes(content))
  content = '中文😀'.repeat(5000)
  const truncated = await loadCoreMemory(tools, budget, signal)
  assert(truncated.includes('truncated')); assert(!truncated.includes('�')); assert(budget.tokens.count(truncated) <= 2048)
  assert.equal(calls, 2); assert.equal(content.length, '中文😀'.repeat(5000).length)
  assert.equal(await loadCoreMemory({ ...tools, call: async () => { throw new ToolError('TOOL_NOT_FOUND') } }, budget, signal), '')
  await assert.rejects(loadCoreMemory({ ...tools, call: async () => { throw new ToolError('TOOL_UNAVAILABLE') } }, budget, signal), { code: 'TOOL_UNAVAILABLE' })
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

for (const outcome of ['success', 'failure', 'cancel'] as const) test(`compaction ${outcome} gates model inference and checkpoint persistence`, async () => {
  let entered!: () => void, release!: () => void
  const began = new Promise<void>(resolve => { entered = resolve }), blocked = new Promise<void>(resolve => { release = resolve })
  const controller = new AbortController(), budget = new ContextBudget(capability(), 'unknown')
  let compacting = false, saves = 0, inferences = 0
  const model = { async complete() {
    compacting = true; entered(); await blocked
    if (outcome === 'failure') throw new Error('Compression failed')
    compacting = false; return { content: 'Summary', toolCalls: [] }
  } }
  const context = new ContextManager({ budget, model, checkpoint: { summary: '', revision: 0, compactedThroughSequence: 0 },
    turns: Array.from({ length: 8 }, (_, i) => ({ sequence: i + 1, messages: [{ role: 'user' as const, content: 'x'.repeat(6000) }] })),
    memory: '', protectedState: [], compacting() {}, save(value) { assert(!compacting); saves++; return { ...value, revision: value.revision + 1 } } })
  const pending = context.prepare(live, [], controller.signal).then(() => { assert(!compacting); assert(saves > 0); inferences++ })
  const checked = outcome === 'success' ? pending : assert.rejects(pending)
  await began; assert.equal(inferences, 0); assert.equal(saves, 0)
  if (outcome === 'cancel') controller.abort()
  release(); await checked
  if (outcome === 'success') assert.equal(inferences, 1)
  else { assert.equal(saves, 0); assert.equal(inferences, 0) }
})
