import { scopedFixture } from './scoped-fixture'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReasoningAccumulator } from '../src/platform/ai/reasoning'
import { parseAgentResponse, providerMessages } from '../src/platform/ai/agent-protocol'
import { compatibleAgentModel } from '../src/platform/ai/agent-model'
import { runPiAgent } from '../src/platform/agent/pi/runtime'
import { ContextBudget } from '../src/platform/agent/context/budget'
import { ContextManager } from '../src/platform/agent/context/manager'
import { modelTask } from '../src/platform/agent/context/model-task'
import { migrate, migrations } from '../src/platform/database/migrations'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/platform/database/sqlite'
import { composeBackend } from '../src/platform/database/backend'
import { createAgentRecorder } from '../src/platform/electron/agent-recorder'
import { redactTranscript } from '../src/platform/electron/transcript-redaction'
import type { AgentRunEvent } from '../src/domain/chat/chat.types'
import type { AgentMessage, AgentModelEvent, AgentRuntimeEvent, StreamingAgentModel } from '../src/shared/agent'

test('reasoning normalization preserves all fields, structured block ordering, mirrors and opaque state', () => {
  const r = new ReasoningAccumulator(), events = [
    ...r.read({ reasoning_details: [{ type: 'reasoning.text', index: 0, text: '检查' }], reasoning: '检查', reasoning_content: '检查' }),
    ...r.read({ reasoning_content: '中文' }),
    ...r.read({ reasoning_details: [{ index: 0, type: 'reasoning.text', text: '中文', signature: 'sig' }], reasoning: '中文' }),
    ...r.read({ reasoning_summary: '摘要', reasoning_details: [{ type: 'reasoning.summary', index: 1, summary: '摘要' }, { type: 'reasoning.encrypted', index: 2, data: 'opaque' }] }),
    ...r.read({ reasoning_details: [{ type: 'reasoning.encrypted', index: 2, data: '-end' }, { type: 'reasoning.text', index: 3, text: '独立段落' }] })
  ]
  assert.equal(events.map(e => e.text).join(''), '检查中文摘要独立段落')
  assert.equal(events.filter(e => e.reasoning.kind === 'encrypted').length, 1)
  assert.equal(JSON.stringify(events).includes('opaque'), false)
  assert.equal(JSON.stringify(events).includes('sig'), false)
  assert.equal(r.state.reasoning_content, '检查中文')
  assert.equal(r.state.reasoning_details?.[2].data, 'opaque-end')
  assert.deepEqual(events.filter(e => e.reasoning.source === 'reasoning_details').map(e => e.reasoning.blockId), ['0', '1', '2', '3'])
  const distinct = new ReasoningAccumulator().read({ reasoning_content: 'full', reasoning: 'different', reasoning_summary: 'summary' })
  assert.equal(distinct.map(e => e.text).join('|'), 'full|different|summary')
  for (const delta of [{ reasoning: 4 }, { reasoning_details: {} }, { reasoning_details: [{ text: {} }] }, { reasoning_details: [{ index: -1 }] }]) assert.throws(() => new ReasoningAccumulator().read(delta), /AGENT_PROTOCOL_ERROR/)
})

test('complete and streaming responses preserve continuation fields without making opaque state display text', async () => {
  const wire = { reasoning_content: '完整推理', reasoning: 'another', reasoning_summary: '摘要', reasoning_details: [{ type: 'reasoning.encrypted', index: 0, data: 'opaque', signature: 'signature' }] }
  const response = parseAgentResponse({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Answer', ...wire } }] }, new Map())
  const messages: AgentMessage[] = [{ role: 'assistant', ...response }]
  assert.deepEqual(providerMessages(messages, new Map())[0], { role: 'assistant', content: 'Answer', ...wire })
  const frame = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\r\n\r\n`
  const bytes = new TextEncoder().encode(frame(wire) + frame({ content: 'Answer' }, 'stop') + 'data: [DONE]\n\n')
  const model = compatibleAgentModel({ provider: { id: 'fixture', name: 'Fixture', baseURL: 'http://localhost', models: ['test'] }, model: 'test', key: null }, {
     transport: async () => new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close() } }), { headers: { 'content-type': 'text/event-stream' } })
  })
  const events: AgentModelEvent[] = []
  for await (const e of model.stream({ messages: [], tools: [], signal: new AbortController().signal })) events.push(e)
  assert.deepEqual(events.at(-1), { type: 'completed', response })
  assert(!JSON.stringify(events.filter(e => e.type === 'reasoning.delta')).includes('opaque'))
})

test('Pi retains provider state across activation/tool turns and segments reasoning by metadata', async () => {
  const budget = new ContextBudget({ contextWindow: 65536, maxOutputTokens: 8192, source: 'manual' }, 'fixture')
  let step = 0
  const seen: AgentMessage[][] = [], events: AgentRuntimeEvent[] = []
  const model: StreamingAgentModel = { complete: async () => ({ content: 'Summary', toolCalls: [] }), async *stream(input) {
    seen.push([...input.messages])
    const turn = step++
    yield { type: 'reasoning.delta', text: 'Body', reasoning: { source: 'reasoning_content', kind: 'text' } }
    yield { type: 'reasoning.delta', text: 'Summary', reasoning: { source: 'reasoning_summary', kind: 'summary' } }
    yield { type: 'reasoning.delta', text: '', reasoning: { source: 'reasoning_details', kind: 'encrypted', blockId: '1' } }
    const call = turn === 0 ? { id: 'activate', name: 'scope.job', arguments: {} } : { id: 'jobs', name: 'job.list', arguments: {} }
    if (turn < 2) yield { type: 'tool_call.ready', call }
    else yield { type: 'content.delta', text: 'Done' }
    yield { type: 'completed', response: { content: turn < 2 ? '' : 'Done', toolCalls: turn < 2 ? [call] : [], providerReasoning: { reasoning_content: `Body-${turn}`, reasoning_details: [{ type: 'reasoning.encrypted', data: `opaque-${turn}` }] } } }
  } }
  const context = new ContextManager({ budget, model, checkpoint: { summary: '', revision: 0, compactedThroughSequence: 0 }, turns: [], memory: '', protectedState: { records: [] }, compacting() {}, save: v => v })
  await runPiAgent({ model, context, budget, signal: new AbortController().signal, system: 'Test', message: 'List jobs',
    tools: scopedFixture({ list: async () => [{ name: 'job.list', description: 'List', inputSchema: { type: 'object' } }], call: async () => ({ items: [], total: 0 }) }), emit: e => events.push(e), status() {}, protect() {} })
  assert.equal(step, 3)
  const assistants = seen[2].filter(m => m.role === 'assistant')
  assert.deepEqual(assistants.map(m => m.providerReasoning?.reasoning_content), ['Body-0', 'Body-1'])
  assert.equal(assistants[0].providerReasoning?.reasoning_details?.[0].data, 'opaque-0')
  assert.deepEqual(events.filter(e => e.type === 'segment.started' && e.kind === 'reasoning').slice(0, 3).map(e => e.type === 'segment.started' ? e.reasoning?.kind : undefined), ['text', 'summary', 'encrypted'])
  assert(!JSON.stringify(events.filter(e => e.type !== 'model.completed')).includes('opaque'))
})

test('transcript redaction preserves business text and removes nested credentials including JSON content blocks', () => {
  assert.deepEqual(redactTranscript({ text: 'Complete business body', API_KEY: 'secret', nested: { access_token: 'token', password: 'pass' }, content: [{ text: '{"secret":"hide","note":"keep"}' }], auth: 'Bearer abc123' }), {
    text: 'Complete business body', API_KEY: '[REDACTED]', nested: { access_token: '[REDACTED]', password: '[REDACTED]' }, content: [{ text: '{"secret":"[REDACTED]","note":"keep"}' }], auth: 'Bearer [REDACTED]'
  })
  const unchanged = '{\n  "business": "Full text"\n}'
  assert.equal(redactTranscript(unchanged), unchanged)
})

test('compaction inputs exclude Host continuation metadata', async () => {
  const budget = new ContextBudget({ contextWindow: 65536, maxOutputTokens: 8192, source: 'manual' }, 'fixture')
  const model = { async complete(input: { messages: readonly AgentMessage[] }) {
    assert(!JSON.stringify(input.messages).includes('opaque'))
    assert(JSON.stringify(input.messages).includes('Business text'))
    return { content: 'Summary', toolCalls: [] }
  } }
  await modelTask(model, budget, 'Summarize', { messages: [{ role: 'assistant', content: 'Business text', providerReasoning: { reasoning_details: [{ data: 'opaque' }] } }] }, 100, new AbortController().signal)
})

test('V12 adds Host continuation storage without rewriting existing migration checksums', () => {
  const db = new DatabaseSync(':memory:')
  try {
    migrate(db, migrations.slice(0, 11))
    const old = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
    migrate(db)
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<=11 ORDER BY version').all(), old)
    assert(db.prepare("SELECT name FROM sqlite_master WHERE name='agent_model_responses'").get())
  } finally { db.close() }
})

test('recorder persists full redacted details and private continuation state across restart without IPC leakage', t => {
  const directory = mkdtempSync(join(tmpdir(), 'reasoning-chat-')), path = join(directory, 'chat.sqlite')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  let backend = composeBackend(openDatabase(path)); t.after(() => backend.close())
  const choice = { providerId: 'fixture', modelId: 'test' }
  const run = backend.chats.start({ requestId: randomUUID(), message: 'Test', choice }), events: AgentRunEvent[] = []
  const recorder = createAgentRecorder(backend.chats, backend.chats.snapshot(run.runId), e => events.push(e), e => { throw e })
  recorder.started()
  recorder.receive({ phase: 'execute', type: 'segment.started', id: 'r', kind: 'reasoning', reasoning: { source: 'reasoning_content', kind: 'text' } })
  recorder.receive({ phase: 'execute', type: 'segment.delta', id: 'r', text: '完整推理' }); recorder.receive({ phase: 'execute', type: 'segment.completed', id: 'r' })
  const call = { id: 'call', name: 'job.list', arguments: { limit: 4, api_key: 'secret-input' } }
  recorder.receive({ phase: 'execute', type: 'model.completed', response: { content: '', toolCalls: [call], providerReasoning: { reasoning_content: '完整推理', reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque-secret', signature: 'sig-secret' }] } } })
  recorder.receive({ phase: 'execute', type: 'tool.started', id: 'tool', call })
  recorder.receive({ phase: 'execute', type: 'tool.completed', id: 'tool', name: 'job.list', result: { items: [{ title: 'Business text', tokenCount: 24, token: 'secret-token', access_token: 'secret-output' }], total: 1 }, durationMs: 25 })
  recorder.finish('completed', null)
  assert(!JSON.stringify(events).includes('opaque-secret')); assert(!JSON.stringify(events).includes('sig-secret'))
  assert(!JSON.stringify(events).includes('secret-input')); assert(!JSON.stringify(events).includes('secret-output'))
  assert(!JSON.stringify(events).includes('secret-token'))
  backend.close(); backend = composeBackend(openDatabase(path))
  const snapshot = backend.chats.snapshot(run.runId), tool = snapshot.items.find(i => i.content.type === 'tool_call')!
  assert.equal(tool.content.type === 'tool_call' && tool.content.callId, 'call')
  assert(JSON.stringify(tool).includes('Business text')); assert(JSON.stringify(tool).includes('"tokenCount":24'))
  assert(!JSON.stringify(snapshot).includes('opaque-secret'))
  const turns = backend.chats.contextTurns(run.sessionId, 999, choice), assistant = turns[0].messages.find(m => m.role === 'assistant')!
  assert.equal(assistant.role === 'assistant' && assistant.providerReasoning?.reasoning_details?.[0].signature, 'sig-secret')
  assert.equal(turns[0].messages.filter(m => m.role === 'assistant').length, 1)
  assert.equal(turns[0].messages.filter(m => m.role === 'tool').length, 1)
  assert(!JSON.stringify(backend.chats.contextTurns(run.sessionId, 999, { ...choice, modelId: 'other' })).includes('opaque-secret'))
  backend.chats.deleteSession(run.sessionId)
  assert.deepEqual(backend.chats.contextTurns(run.sessionId, 999), [])
})
