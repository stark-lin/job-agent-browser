import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createAIService } from '../src/platform/ai'
import { requestConfig } from '../src/platform/ai/transport'
import { compatibleAgentModel } from '../src/platform/agent/compatible'
import { createURLReader } from '../src/platform/job-import/url-reader'
import { defaultAITimeouts, type AISettings, type AIEvent } from '../src/shared/ai'

const choice = { providerId: 'local', modelId: 'model' }
const settings = (): AISettings => ({ providers: [{ id: 'local', name: 'Local', baseURL: 'http://localhost:1234', requiresKey: false, models: ['model'], defaultModel: 'model' }], default: choice,
  timeouts: { ...defaultAITimeouts, requestSeconds: 1, pageSeconds: 2, modelsSeconds: 3 } })
const pendingTransport: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
  const signal = init!.signal!
  if (signal.aborted) { reject(signal.reason); return }
  signal.addEventListener('abort', () => reject(signal.reason), { once: true })
})

test('chat snapshots the configured deadline and later requests use the new saved limit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const config = settings(), events: AIEvent[] = []
  const ai = createAIService({ settings: () => config, key: () => null, audit() {}, transport: pendingTransport })
  t.after(() => ai.dispose())
  const start = () => new Promise<void>(resolve => ai.start(1, { choice, messages: [{ role: 'user', content: 'test' }] }, event => {
    events.push(event); if (event.type === 'failed') resolve()
  }))
  const first = start()
  config.timeouts!.requestSeconds = 2
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
  const ai = createAIService({ settings: () => config, key: () => null, audit() {}, transport: pendingTransport })
  t.after(() => ai.dispose())
  let settled = false
  const pending = ai.listModels(1, { providerId: 'local' }).finally(() => { settled = true })
  const rejected = assert.rejects(pending, { code: 'AI_TIMEOUT' })
  config.timeouts!.modelsSeconds = 10
  t.mock.timers.tick(2999); await nextTurn(); assert.equal(settled, false)
  t.mock.timers.tick(1); await rejected
})

test('resume model calls inherit the configured AI timeout through the shared configuration snapshot', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const config = settings(), snapshot = requestConfig(config, () => null, choice)
  config.timeouts!.requestSeconds = 10
  const model = compatibleAgentModel(snapshot, { audit() {}, transport: pendingTransport })
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
