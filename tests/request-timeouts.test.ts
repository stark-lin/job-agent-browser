import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createAIService } from '../src/platform/ai'
import { requestConfig } from '../src/platform/ai/transport'
import { compatibleAgentModel } from '../src/platform/ai/agent-model'
import { createURLReader } from '../src/platform/job-import/url-reader'
import { AI_TIMEOUT, type AISettings } from '../src/shared/ai'

const choice = { providerId: 'local', modelId: 'model' }, baseURL = 'http://localhost:1234'
const settings: AISettings = { providers: [{ id: 'local', name: 'Local', baseURL, models: ['model'] }], default: choice }
const pendingTransport: typeof fetch = async () => new Promise(() => {})
const snapshot = requestConfig(settings, () => null, choice)

test('model discovery, job pages and non-streaming inference use independent total deadlines', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ai = createAIService({ settings: () => settings, key: () => null, transport: pendingTransport })
  t.after(() => ai.dispose())
  const signal = new AbortController().signal
  const pending = [
    [AI_TIMEOUT.models, ai.listModels(1, { baseURL }), 'AI_TIMEOUT'],
    [AI_TIMEOUT.page, createURLReader(pendingTransport).read('https://example.com/job', signal), 'JOB_FETCH_TIMEOUT'],
    [AI_TIMEOUT.inference, compatibleAgentModel(snapshot, { transport: pendingTransport }).complete({ messages: [], tools: [], signal }), 'AGENT_TIMEOUT']
  ] as const
  const settled: string[] = []
  const rejected = pending.map(([, request, code]) => assert.rejects(request, { code }).then(() => settled.push(code)))
  let elapsed = 0
  for (let index = 0; index < pending.length; index++) {
    const [timeout, , code] = pending[index]
    t.mock.timers.tick(timeout - elapsed - 1); await nextTurn()
    assert.equal(settled.length, index)
    t.mock.timers.tick(1); await rejected[index]
    assert.equal(settled.at(-1), code)
    elapsed = timeout
  }
})

test('streaming deadline resets on model content and ignores keepalives and empty frames', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let feed!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(controller) { feed = controller } })
  const model = compatibleAgentModel(snapshot, { transport: async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }) })
  const send = (text: string) => feed.enqueue(new TextEncoder().encode(text))
  const iterator = model.stream({ messages: [], tools: [], signal: new AbortController().signal })[Symbol.asyncIterator]()
  const next = iterator.next()
  await nextTurn(); t.mock.timers.tick(AI_TIMEOUT.inference - 1)
  send('data: {"choices":[{"delta":{"content":"valid"}}]}\n\n')
  assert.deepEqual((await next).value, { type: 'content.delta', text: 'valid' })
  const later = assert.rejects(iterator.next(), { code: 'AGENT_TIMEOUT' })
  t.mock.timers.tick(AI_TIMEOUT.inference - 1)
  send(': keepalive\n\ndata: {"choices":[]}\n\ndata: {"choices":[{"delta":{}}]}\n\n')
  await nextTurn(); t.mock.timers.tick(1)
  await later
})

test('user abort interrupts a stalled inference immediately', async () => {
  const controller = new AbortController()
  const model = compatibleAgentModel(snapshot, { transport: pendingTransport })
  const pending = assert.rejects(model.complete({ messages: [], tools: [], signal: controller.signal }), { code: 'AGENT_CANCELLED' })
  controller.abort()
  await pending
})
