import test from 'node:test'
import assert from 'node:assert/strict'
import { compatibleAgentModel } from '../src/platform/ai/agent-model'
import { runStreamingAgent, type StreamLoopEvent } from '../src/platform/agent/stream-loop'
import type { AgentModelEvent, StreamingAgentModel, AgentTools } from '../src/shared/agent'
import { ToolError } from '../src/shared/tools/errors'
const config = { provider: { id: 'test', name: 'Test', baseURL: 'http://localhost/v1', requiresKey: false, models: ['test'], defaultModel: 'test' }, model: 'test', key: null }
const signal = () => new AbortController().signal
const descriptor = { name: 'job.list', description: 'List', inputSchema: { type: 'object' as const } }
const frame = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\r\n\r\n`
const stream = (text: string, size = 1) => new Response(new ReadableStream({ start(controller) { const bytes = new TextEncoder().encode(text); for (let n = 0; n < bytes.length; n += size) controller.enqueue(bytes.slice(n, n + size)); controller.close() } }), { headers: { 'content-type': 'text/event-stream' } })
const collect = async (iterable: AsyncIterable<AgentModelEvent>) => { const events = []; for await (const event of iterable) events.push(event); return events }

test('stream adapter assembles byte-fragmented Unicode, public summaries and tool batches before executable events', async () => {
  const audits: unknown[] = []
  const text = frame({ reasoning_summary: 'Checking 中文', reasoning_content: 'PRIVATE COT' }) + frame({ content: 'Hello ' })
    + frame({ tool_calls: [{ index: 0, id: 'ca', type: 'function', function: { name: 'tool_', arguments: '{"li' } }] })
    + frame({ tool_calls: [{ index: 0, id: 'll', function: { name: '0', arguments: 'mit":2}' } }] }, 'tool_calls') + 'data: [DONE]\n\n'
  const model = compatibleAgentModel(config, { audit: (_id, error) => audits.push(error), transport: async () => stream(text) })
  const events = await collect(model.stream({ messages: [], tools: [descriptor], signal: signal() }))
  assert.deepEqual(events.map(e => e.type), ['reasoning.delta', 'content.delta', 'tool_call.ready', 'completed'])
  assert.equal(JSON.stringify(events).includes('PRIVATE COT'), false)
  const ready = events[2]; assert(ready.type === 'tool_call.ready'); assert.deepEqual(ready.call, { id: 'call', name: 'job.list', arguments: { limit: 2 } })
  assert.deepEqual(audits, [null])
})
test('malformed batches, truncation, duplicate IDs, unknown names and audit failures never expose executable calls', async () => {
  for (const text of [frame({ content: 'partial' }), frame({ content: 'x' }, 'length') + 'data: [DONE]\n\n',
    frame({ tool_calls: [{ index: 0, id: 'a', type: 'function', function: { name: 'tool_0', arguments: '{' } }] }, 'tool_calls') + 'data: [DONE]\n\n',
    frame({ tool_calls: [0, 1].map(index => ({ index, id: 'same', type: 'function', function: { name: 'tool_0', arguments: '{}' } })) }, 'tool_calls') + 'data: [DONE]\n\n',
    frame({ tool_calls: [{ index: 0, id: 'a', type: 'function', function: { name: 'unknown', arguments: '{}' } }] }, 'tool_calls') + 'data: [DONE]\n\n']) {
    const model = compatibleAgentModel(config, { audit() {}, transport: async () => stream(text) }), events: AgentModelEvent[] = []
    await assert.rejects((async () => { for await (const e of model.stream({ messages: [], tools: [descriptor], signal: signal() })) events.push(e) })(), /AGENT_PROTOCOL_ERROR/)
    assert(!events.some(e => e.type === 'tool_call.ready'))
  }
  const model = compatibleAgentModel(config, { audit() { throw new Error('private') }, transport: async () => stream(frame({ content: 'ok' }, 'stop') + 'data: [DONE]\n\n') })
  await assert.rejects(collect(model.stream({ messages: [], tools: [], signal: signal() })), /AUDIT_UNAVAILABLE/)
  const timeout = compatibleAgentModel(config, { audit() {}, timeoutMs: 10, transport: () => new Promise(() => {}) })
  await assert.rejects(collect(timeout.stream({ messages: [], tools: [], signal: signal() })), /AGENT_TIMEOUT/)
  const controller = new AbortController(), pending = collect(compatibleAgentModel(config, { audit() {}, transport: () => new Promise(() => {}) }).stream({ messages: [], tools: [], signal: controller.signal }))
  controller.abort(); await assert.rejects(pending, /AGENT_CANCELLED/)
})
function fixtureModel(batches: AgentModelEvent[][]): StreamingAgentModel { return { complete: async () => ({ content: '', toolCalls: [] }), async *stream() { yield* batches.shift()! } } }
const final = (text: string): AgentModelEvent[] => [{ type: 'content.delta', text }, { type: 'completed', response: { content: text, toolCalls: [] } }]
test('stream loop preserves interleaving, complete call batches, recoverable errors and fatal audit boundaries', async () => {
  const call = { id: 'a', name: 'job.list', arguments: {} }, events: StreamLoopEvent[] = [], observations: unknown[] = []
  const tools: AgentTools = { list: async () => [descriptor], call: async () => { throw new ToolError('TOOL_FORBIDDEN') } }
  const first: AgentModelEvent[] = [{ type: 'reasoning.delta', text: 'Summary' }, { type: 'content.delta', text: 'Reading' }, { type: 'reasoning.delta', text: 'More' }, { type: 'tool_call.ready', call }, { type: 'completed', response: { content: 'Reading', toolCalls: [call] } }]
  const model = fixtureModel([first, final('Recovered')]), original = model.stream
  model.stream = input => { observations.push(input.messages); return original(input) }
  await runStreamingAgent(model, tools, [], signal(), e => events.push(e))
  assert.deepEqual(events.filter(e => e.type === 'segment.started').map(e => e.kind), ['reasoning', 'assistant_message', 'reasoning', 'assistant_message'])
  assert(events.some(e => e.type === 'tool.failed')); assert(JSON.stringify(observations).includes('TOOL_FORBIDDEN'))
  await assert.rejects(runStreamingAgent(fixtureModel([first]), { ...tools, call: async () => { throw new ToolError('TOOL_AUDIT_UNAVAILABLE') } }, [], signal(), () => {}), /TOOL_AUDIT_UNAVAILABLE/)
  const repeated = fixtureModel(Array.from({ length: 8 }, (_, index) => {
    const c = { ...call, id: String(index) }; return [{ type: 'tool_call.ready', call: c }, { type: 'completed', response: { content: '', toolCalls: [c] } }]
  }))
  await assert.rejects(runStreamingAgent(repeated, { ...tools, call: async () => ({}) }, [], signal(), () => {}), /AGENT_STEP_LIMIT/)
})
