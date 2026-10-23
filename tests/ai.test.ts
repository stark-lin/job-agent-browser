import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createAIService } from '../src/platform/ai'
import type { AIService } from '../src/platform/ai'
import { openDatabase } from '../src/platform/database/sqlite'
import { composeBackend } from '../src/platform/database/backend'
import type { AIEvent, AIInput, AISettings } from '../src/shared/ai'
import { AIStreamClient } from '../src/app/ai/streamClient'
import type { AIAPI } from '../src/shared/ai'
import { value } from './helpers'

const input: AIInput = { choice: { providerId: 'custom', modelId: 'custom/model' }, messages: [{ role: 'user', content: 'PRIVATE_PROMPT_EMAIL@example.com' }] }
const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\r\n\r\n`
const success = chunk({ role: 'assistant', content: '' }) + chunk({ content: 'PRIVATE_REPLY中文' }) + chunk({}, 'stop') + 'data: [DONE]\r\n\r\n'
async function server(t: TestContext, handler: (response: ServerResponse, body: string, authorization?: string, url?: string) => void) {
  const http = createServer((request, response) => {
    let body = ''
    request.on('data', data => { body += data })
    request.on('end', () => handler(response, body, request.headers.authorization, request.url))
  })
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => { http.closeAllConnections(); http.close(() => resolve()) }))
  const address = http.address()
  assert(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}/gateway/v1`
}
function fixture(t: TestContext, baseURL: string, timeoutMs = 2000) {
  const database = openDatabase(':memory:'), backend = composeBackend(database)
  const settings: AISettings = { providers: [{ id: 'custom', name: 'PRIVATE_PROVIDER', baseURL, requiresKey: true, models: ['custom/model'], defaultModel: 'custom/model' }], default: input.choice }
  const service = createAIService({ settings: () => settings, key: () => 'PRIVATE_API_KEY', audit: backend.recordAI, timeoutMs })
  t.after(async () => { await service.dispose(); backend.close() })
  return { database, backend, settings, service, logs: () => value(backend.dispatch('audit', 'list', { targetType: 'ai_request' }) as import('../src/shared/ipc').Result<import('../src/domain/common/ports').PageResult<import('../src/domain/common/ports').AuditEntry>>) }
}
function run(service: AIService, onEvent: (event: AIEvent) => void = () => {}, args = input) {
  const events: AIEvent[] = []
  return new Promise<AIEvent[]>(resolve => {
    service.start(1, args, event => {
      events.push(event); onEvent(event)
      if (['completed', 'failed', 'cancelled'].includes(event.type)) resolve(events)
    })
  })
}

test('real compatible SSE streams split UTF-8, preserves base paths and audits only startup with existing fields', async t => {
  const url = await server(t, (response, body, authorization, path) => {
    assert.equal(path, '/gateway/v1/chat/completions')
    assert.equal(authorization, 'Bearer PRIVATE_API_KEY')
    assert.deepEqual(JSON.parse(body), { model: 'custom/model', messages: input.messages, stream: true })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const bytes = Buffer.from(': heartbeat\r\n\r\n' + success)
    for (let i = 0; i < bytes.length; i += 3) response.write(bytes.subarray(i, i + 3))
    response.end()
  })
  const f = fixture(t, url), events = await run(f.service)
  assert.deepEqual(events.map(event => event.type), ['started', 'delta', 'completed'])
  assert.equal(events.filter(event => event.type === 'delta').map(event => event.text).join(''), 'PRIVATE_REPLY中文')
  const logs = f.logs()
  assert.equal(logs.total, 1)
  assert.equal(logs.items[0].status, 'SUCCESS')
  assert.equal(logs.items[0].eventType, 'AI_STREAM_START')
  assert.equal(logs.items[0].targetId, events[0].requestId)
  assert.equal(logs.items[0].requestId, events[0].requestId)
  assert.equal(Object.keys(logs.items[0]).length, 15)
  for (const marker of ['PRIVATE_', url, 'custom/model']) assert.equal(JSON.stringify(logs).includes(marker), false)
})

test('HTTP failures are classified without storing provider bodies and retries have distinct request IDs', async t => {
  const url = await server(t, response => { response.writeHead(401); response.end('PRIVATE_ERROR_BODY') })
  const f = fixture(t, url)
  for (let i = 0; i < 2; i++) {
    const events = await run(f.service)
    assert.deepEqual(events.map(event => event.type), ['failed'])
    assert.equal(events[0].type === 'failed' && events[0].error, 'AI_AUTH_FAILED')
  }
  const logs = f.logs()
  assert.equal(logs.total, 2)
  assert.equal(new Set(logs.items.map(entry => entry.requestId)).size, 2)
  assert(logs.items.every(entry => entry.error === 'AI_AUTH_FAILED' && entry.status === 'FAILURE'))
  assert.equal(JSON.stringify(logs).includes('PRIVATE'), false)
})

test('a midstream failure leaves the single successful startup audit unchanged', async t => {
  const url = await server(t, response => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(chunk({ content: 'partial' }) + 'data: {broken PRIVATE_ERROR}\n\n')
  })
  const f = fixture(t, url), events = await run(f.service)
  assert.deepEqual(events.map(event => event.type), ['started', 'delta', 'failed'])
  assert.equal(events.at(-1)?.type === 'failed' && (events.at(-1) as { error: string }).error, 'AI_PROTOCOL_ERROR')
  assert.equal(f.logs().total, 1)
  assert.equal(f.logs().items[0].status, 'SUCCESS')
})

test('cancelling after startup stops the stream, enforces owner isolation and creates no terminal audit', async t => {
  const url = await server(t, response => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(chunk({ content: 'partial' }))
  })
  const f = fixture(t, url)
  const events = await run(f.service, event => {
    if (event.type === 'delta') {
      assert.throws(() => f.service.cancel(2, event.requestId), { code: 'FORBIDDEN' })
      f.service.cancel(1, event.requestId)
    }
  })
  assert.equal(events.at(-1)?.type, 'cancelled')
  assert.equal(f.logs().total, 1)
  assert.equal(f.logs().items[0].status, 'SUCCESS')
})

test('cancellation before any SSE event and timeout each produce one failed startup audit', async t => {
  const url = await server(t, response => { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.flushHeaders() })
  const f = fixture(t, url, 30)
  const cancelled = await new Promise<AIEvent>(resolve => {
    const { requestId } = f.service.start(1, input, event => { if (event.type === 'cancelled') resolve(event) })
    f.service.cancel(1, requestId)
  })
  assert.equal(cancelled.type, 'cancelled')
  const events = await run(f.service)
  assert.equal(events.at(-1)?.type === 'failed' && (events.at(-1) as { error: string }).error, 'AI_TIMEOUT')
  assert.deepEqual(new Set(f.logs().items.map(entry => entry.error)), new Set(['AI_CANCELLED', 'AI_TIMEOUT']))
})

test('audit write failure aborts before any text is delivered and does not claim success', async t => {
  const url = await server(t, response => { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end(success) })
  const f = fixture(t, url)
  f.database.connection.exec('PRAGMA query_only=ON')
  const events = await run(f.service)
  assert.deepEqual(events.map(event => event.type), ['failed'])
  assert.equal(events[0].type === 'failed' && events[0].error, 'AUDIT_UNAVAILABLE')
  f.database.connection.exec('PRAGMA query_only=OFF')
  assert.equal(f.logs().total, 0)
})

test('request configuration is frozen, no-key providers send no authorization, and malformed inputs do not execute', async t => {
  const url = await server(t, (response, body, authorization) => {
    assert.equal(authorization, undefined)
    assert.equal(JSON.parse(body).model, 'custom/model')
    response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end(success)
  })
  const f = fixture(t, url)
  f.settings.providers[0].requiresKey = false
  assert.throws(() => f.service.start(1, { ...input, actorId: 'FORGED' }, () => {}), { code: 'INVALID_INPUT' })
  assert.throws(() => f.service.start(1, { ...input, messages: [{ role: 'system', content: 'FORGED' }] }, () => {}), { code: 'INVALID_INPUT' })
  const result = run(f.service)
  f.settings.providers[0].baseURL = 'http://127.0.0.1:1'
  f.settings.providers[0].requiresKey = true
  f.settings.providers[0].models = []
  assert.equal((await result).at(-1)?.type, 'completed')
  assert.equal(f.logs().total, 1)
})

test('redirects are not followed and provider credentials never reach the redirect destination', async t => {
  let forwarded = false
  const target = await server(t, response => { forwarded = true; response.end() })
  const source = await server(t, response => { response.writeHead(307, { Location: target }); response.end() })
  const f = fixture(t, source), events = await run(f.service)
  assert.equal(events.at(-1)?.type, 'failed')
  assert.equal(forwarded, false)
  assert.equal(f.logs().items[0].status, 'FAILURE')
})

test('renderer client buffers events emitted before invoke resolves and cleans terminal subscriptions', async () => {
  const requestId = randomUUID(), listeners = new Set<(event: AIEvent) => void>()
  const api: AIAPI = {
    start: async () => {
      for (const listener of listeners) {
        listener({ requestId, type: 'started' }); listener({ requestId, type: 'delta', text: 'early' }); listener({ requestId, type: 'completed' })
      }
      return { ok: true, value: { requestId } }
    },
    cancel: async () => ({ ok: true, value: null }),
    onEvent: listener => { listeners.add(listener); return () => { listeners.delete(listener) } }
  }
  const client = new AIStreamClient(api), events: AIEvent[] = []
  await client.start(input, event => events.push(event))
  assert.deepEqual(events.map(event => event.type), ['started', 'delta', 'completed'])
  assert.equal(listeners.size, 0)
})

test('SSE decoder handles byte-level UTF-8 boundaries, multiline data and ignores empty chunks', async () => {
  const { streamChat } = await import('../src/platform/ai/compatible.js')
  const bytes = new TextEncoder().encode(': heartbeat\r\n\r\n' + chunk({}) +
    'data: {"choices":\r\ndata: [{"delta":{"content":"你好"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n')
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
    controller.close()
  } })
  let starts = 0, text = ''
  await streamChat({ provider: { id: 'local', name: 'Local', baseURL: 'http://localhost/v1', requiresKey: false, models: ['test'], defaultModel: 'test' }, model: 'test', key: null, messages: input.messages },
    new AbortController().signal, () => { starts++ }, delta => { text += delta }, async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))
  assert.equal(starts, 1)
  assert.equal(text, '你好')
})

test('missing configuration fails once without contacting a provider', async t => {
  const f = fixture(t, 'http://127.0.0.1:1')
  f.settings.providers = []
  const events = await run(f.service)
  assert.equal(events[0].type === 'failed' && events[0].error, 'AI_NOT_CONFIGURED')
  assert.equal(f.logs().total, 1)
  assert.equal(f.logs().items[0].error, 'AI_NOT_CONFIGURED')
})

test('renderer disposal cancels a request whose ID arrives late and removes its listener', async () => {
  const requestId = randomUUID(), cancelled: string[] = []
  let resolve!: (value: { ok: true; value: { requestId: string } }) => void
  let listener: ((event: AIEvent) => void) | null = null
  const api: AIAPI = {
    start: () => new Promise(done => { resolve = done }),
    cancel: async input => { cancelled.push(input.requestId); return { ok: true, value: null } },
    onEvent: callback => { listener = callback; return () => { listener = null } }
  }
  const client = new AIStreamClient(api), events: AIEvent[] = []
  const pending = client.start(input, event => events.push(event))
  client.dispose()
  resolve({ ok: true, value: { requestId } })
  await pending
  assert.deepEqual(cancelled, [requestId])
  assert.equal(listener, null)
  assert.equal(events.length, 0)
})
