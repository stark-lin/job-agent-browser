import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createAIService } from '../src/platform/ai'
import { requestConfig } from '../src/platform/ai/transport'
import { compatibleAgentModel } from '../src/platform/ai/agent-model'
import { createURLReader } from '../src/platform/job-import/url-reader'
import { AI_DEFAULTS, type AISettings, type AIEvent } from '../src/shared/ai'

const choice = { providerId: 'local', modelId: 'model' }
const settings = (): AISettings => ({ providers: [{ id: 'local', name: 'Local', baseURL: 'http://localhost:1234', models: ['model'] }], default: choice,
  timeoutOverrides: { requestSeconds: 1, pageSeconds: 2, modelsSeconds: 3 } })
const pendingTransport: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
  const signal = init!.signal!
  if (signal.aborted) { reject(signal.reason); return }
  signal.addEventListener('abort', () => reject(signal.reason), { once: true })
})

test('chat snapshots the configured deadline and later requests use the new saved limit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const config = settings(), events: AIEvent[] = []
  const ai = createAIService({ settings: () => config, key: () => null,  transport: pendingTransport })
  t.after(() => ai.dispose())
  const start = () => new Promise<void>(resolve => ai.start(1, { choice, messages: [{ role: 'user', content: 'test' }] }, event => {
    events.push(event); if (event.type === 'failed') resolve()
  }))
  const first = start()
  config.timeoutOverrides!.requestSeconds = 2
  await nextTurn()
  t.mock.timers.tick(999); await nextTurn(); assert.equal(events.length, 0)
  t.mock.timers.tick(1); await first
  assert.equal(events[0].type === 'failed' && events[0].error, 'AI_TIMEOUT')
  const second = start(); await nextTurn()
  t.mock.timers.tick(1000); await nextTurn(); assert.equal(events.length, 1)
  t.mock.timers.tick(1000); await second
  assert.equal(events.length, 2)
})

test('model detection uses its separate timeout and keeps the active deadline when settings change', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const config = settings()
  const ai = createAIService({ settings: () => config, key: () => null,  transport: pendingTransport })
  t.after(() => ai.dispose())
  let settled = false
  const pending = ai.listModels(1, { baseURL: config.providers[0].baseURL }).finally(() => { settled = true })
  const rejected = assert.rejects(pending, { code: 'AI_TIMEOUT' })
  config.timeoutOverrides!.modelsSeconds = 10
  t.mock.timers.tick(2999); await nextTurn(); assert.equal(settled, false)
  t.mock.timers.tick(1); await rejected
})

test('resume model calls inherit the configured AI timeout through the shared configuration snapshot', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const config = settings(), snapshot = requestConfig(config, () => null, choice)
  config.timeoutOverrides!.requestSeconds = 10
  const model = compatibleAgentModel(snapshot, { transport: pendingTransport })
  let settled = false
  const pending = model.complete({ messages: [], tools: [], signal: new AbortController().signal }).finally(() => { settled = true })
  const rejected = assert.rejects(pending, /AGENT_TIMEOUT/)
  t.mock.timers.tick(999); await nextTurn(); assert.equal(settled, false)
  t.mock.timers.tick(1); await rejected
})

test('job reading snapshots its own deadline and refreshes the saved value for the next read', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let seconds = 2, settled = false
  const reader = createURLReader(pendingTransport, () => seconds * 1000)
  const first = reader.read('https://example.com/job', new AbortController().signal).finally(() => { settled = true })
  const rejected = assert.rejects(first, /JOB_FETCH_TIMEOUT/)
  seconds = 4
  t.mock.timers.tick(1999); await nextTurn(); assert.equal(settled, false)
  t.mock.timers.tick(1); await rejected
  settled = false
  const second = reader.read('https://example.com/job', new AbortController().signal).finally(() => { settled = true })
  const secondRejected = assert.rejects(second, /JOB_FETCH_TIMEOUT/)
  t.mock.timers.tick(3999); await nextTurn(); assert.equal(settled, false)
  t.mock.timers.tick(1); await secondRejected
})

test('AI defaults are independent of persisted timeout overrides', () => {
  const config = settings()
  delete config.timeoutOverrides
  assert.equal(requestConfig(config, () => null, choice).timeoutMs, 300_000)
  assert.equal(AI_DEFAULTS.modelsTimeoutMs, 15_000)
  assert.equal(AI_DEFAULTS.pageTimeoutMs, 20_000)
})

for (const mode of ['chat', 'agent'] as const) test(`${mode} streaming refreshes on content and times out through keepalives`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const config = settings(), controller = new AbortController()
  let write!: (value: string) => void, started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const transport: typeof fetch = async () => new Response(new ReadableStream({
    start(stream) {
      write = value => stream.enqueue(new TextEncoder().encode(value))
      started()
    }
  }), { headers: { 'Content-Type': 'text/event-stream' } })
  const events: string[] = []
  const service = createAIService({ settings: () => config, key: () => null, transport })
  t.after(() => service.dispose())
  const model = compatibleAgentModel(requestConfig(config, () => null, choice), { transport })
  const completion = mode === 'chat'
    ? new Promise<string>(resolve => service.start(1, { choice, messages: [{ role: 'user', content: 'test' }] }, event => {
      if (event.type === 'delta') events.push(event.text)
      if (event.type === 'failed') resolve(event.error)
    }))
    : (async () => {
      try {
        for await (const event of model.stream({ messages: [], tools: [], signal: controller.signal })) {
          if (event.type === 'content.delta') events.push(event.text)
        }
        return 'completed'
      } catch (error) { return (error as Error).message }
    })()
  await ready
  const frame = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
  t.mock.timers.tick(800); write(frame('one')); await nextTurn()
  t.mock.timers.tick(800); write(frame('two')); await nextTurn()
  assert.deepEqual(events, ['one', 'two'])
  t.mock.timers.tick(800); write(': keepalive\n\ndata: {"choices":[{"delta":{}}]}\n\n'); await nextTurn()
  t.mock.timers.tick(200)
  assert.equal(await completion, mode === 'chat' ? 'AI_TIMEOUT' : 'AGENT_TIMEOUT')
})
