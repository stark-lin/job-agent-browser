import test from 'node:test'
import assert from 'node:assert/strict'
import { createAIService } from '../src/platform/ai'
import type { AIEvent, AISettings } from '../src/shared/ai'

const choice = { providerId: 'local', modelId: 'model' }
const settings: AISettings = { default: choice, providers: [{ id: 'local', name: 'Local', baseURL: 'http://127.0.0.1', requiresKey: false, models: ['model'], defaultModel: 'model' }] }
const input = { choice, messages: [{ role: 'user', content: 'Extract data' }] }
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function fixture() {
  const calls: { complete: () => void; owner: number }[] = [], audits: string[] = []
  let active = 0, maximum = 0
  const service = createAIService({ settings: () => settings, key: () => null, audit: (_id, error) => { audits.push(error ?? 'SUCCESS') }, timeoutMs: 500,
    transport: async (_url, init) => {
      const owner = Number(JSON.parse(String(init?.body)).messages[0].content)
      active++; maximum = Math.max(maximum, active)
      return new Promise<Response>((resolve, reject) => {
        const abort = () => { active--; reject(new Error('aborted')) }
        init?.signal?.addEventListener('abort', abort, { once: true })
        calls.push({ owner, complete() {
          init?.signal?.removeEventListener('abort', abort); active--
          resolve(new Response('data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
        } })
      })
    }
  })
  return { service, calls, audits, maximum: () => maximum }
}

test('import queue shares owner/global slots and cancels queued requests without calling the provider', async () => {
  const f = fixture(), events: AIEvent[] = [], running: string[] = []
  const start = (owner: number) => f.service.start(owner, { ...input, messages: [{ role: 'user', content: String(owner) }] }, event => events.push(event), {
    queue: true, onRunning: () => { running.push(String(owner)) }
  })
  const ids = Array.from({ length: 6 }, () => start(1))
  await tick(); assert.equal(f.calls.length, 4); assert.equal(running.length, 4)
  assert.throws(() => f.service.cancel(2, ids[5].requestId), /FORBIDDEN/)
  f.service.cancel(1, ids[5].requestId)
  assert(events.some(event => event.requestId === ids[5].requestId && event.type === 'cancelled'))
  assert(f.audits.includes('AI_CANCELLED'))
  f.calls[0].complete(); await tick()
  assert.equal(f.calls.length, 5); assert.equal(f.maximum(), 4)
  for (let index = 1; index < 5; index++) f.calls[index].complete()
  await tick(); assert.equal(events.filter(event => event.type === 'completed').length, 5)
  await f.service.dispose()
})

test('queued imports never exceed sixteen global calls and other owners can use free slots', async () => {
  const f = fixture(), terminal: AIEvent[] = []
  for (let owner = 1; owner <= 5; owner++) {
    for (let index = 0; index < 5; index++) f.service.start(owner, { ...input, messages: [{ role: 'user', content: String(owner) }] }, event => {
      if (event.type === 'cancelled' || event.type === 'failed') terminal.push(event)
    }, { queue: true, onRunning() {} })
  }
  await tick(); assert.equal(f.calls.length, 16); assert.equal(f.maximum(), 16)
  for (let owner = 1; owner <= 4; owner++) assert.equal(f.calls.filter(call => call.owner === owner).length, 4)
  f.service.disposeOwner(1); await tick()
  assert.equal(f.calls.filter(call => call.owner === 5).length, 4)
  await f.service.dispose()
  assert.equal(terminal.length, 25)
})
