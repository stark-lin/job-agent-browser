import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createAIService } from '../src/platform/ai'
import { postChat } from '../src/platform/ai/transport'
import { createAIBridge } from '../src/platform/electron/preload/ai-bridge'
import type { AISettings } from '../src/shared/ai'

async function server(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const http = createServer(handler)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => { http.closeAllConnections(); http.close(() => resolve()) }))
  const address = http.address(); assert(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}
function fixture(t: TestContext, baseURL: string, timeoutMs = 1000) {
  const settings: AISettings = { providers: [{ id: 'local', name: 'LM Studio', baseURL, models: [] }], default: null }
  let keys = 0
  const ai = createAIService({ settings: () => settings, key: () => { keys++; return 'PRIVATE_KEY' }, timeoutMs })
  t.after(() => ai.dispose())
  return { ai, settings, keys: () => keys }
}
const input = (baseURL: string) => ({ baseURL })

test('bare endpoints and explicit API roots share GET model discovery and POST chat URL handling', async t => {
  const requests: string[] = []
  const root = await server(t, (req, res) => {
    requests.push(`${req.method} ${req.url}`)
    assert.equal(req.headers.authorization, undefined)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'z/model' }, { id: 'a-model' }, { id: 'z/model' }] }))
  })
  for (const [suffix, path] of [['', '/v1'], ['/', '/v1'], ['/v1', '/v1'], ['/v1/', '/v1'], ['/gateway/v1/', '/gateway/v1'], ['/custom/api', '/custom/api']]) {
    const f = fixture(t, root + suffix)
    assert.deepEqual(await f.ai.listModels(1, input(root + suffix)), ['a-model', 'z/model'])
    assert.deepEqual(f.settings.providers[0].models, [])
    assert.equal(f.keys(), 0)
    const response = await postChat({ provider: f.settings.providers[0], key: null, model: 'a-model' }, { messages: [] }, new AbortController().signal, false)
    await response.body?.cancel()
    assert.deepEqual(requests.slice(-2), [`GET ${path}/models`, `POST ${path}/chat/completions`])
  }
})

test('discovery reuses a saved credential for the original endpoint without a default model', async t => {
  const root = await server(t, (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer PRIVATE_KEY')
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[{"id":"local/model"}]}')
  })
  const f = fixture(t, root)
  const pending = f.ai.listModels(1, { ...input(root), providerId: 'local' })
  f.settings.providers[0].baseURL = 'http://127.0.0.1:1'
  assert.deepEqual(await pending, ['local/model'])
  assert.equal(f.keys(), 1)
})

test('temporary credentials take precedence and saved keys never cross origins', async t => {
  const seen: (string | undefined)[] = []
  const root = await server(t, (req, res) => {
    seen.push(req.headers.authorization)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"data":[{"id":"model"}]}')
  })
  const { ai, keys } = fixture(t, 'http://127.0.0.1:1')
  for (const value of [null, {}, { ...input(root), providerId: '__proto__' }, { baseURL: 'http://example.com' }, { ...input(root), apiKey: 'two words' }]) {
    assert.throws(() => ai.listModels(1, value), { code: 'INVALID_INPUT' })
  }
  assert.deepEqual(await ai.listModels(1, { ...input(root), apiKey: ' ', providerId: 'local' }), ['model'])
  assert.deepEqual(await ai.listModels(1, { ...input(root), apiKey: 'TEMP_KEY' }), ['model'])
  assert.deepEqual(seen, [undefined, 'Bearer TEMP_KEY'])
  assert.equal(keys(), 0)
})

test('HTTP model failures use existing sanitized error codes', async t => {
  for (const [status, code] of [[401, 'AI_AUTH_FAILED'], [403, 'AI_AUTH_FAILED'], [429, 'AI_RATE_LIMITED'], [404, 'AI_PROVIDER_FAILED'], [500, 'AI_PROVIDER_FAILED']] as const) {
    const root = await server(t, (_req, res) => { res.writeHead(status); res.end('PRIVATE_PROVIDER_BODY') })
    await assert.rejects(fixture(t, root).ai.listModels(1, input(root)), { code })
  }
})

test('model discovery rejects malformed, oversized and non-JSON responses and empty model lists', async t => {
  let body = '', contentType = 'application/json'
  const root = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': contentType }); res.end(body) })
  const { ai } = fixture(t, root)
  for (const invalid of ['{', 'null', '{}', '{"error":{"message":"PRIVATE"}}', '{"data":[null]}', '{"data":[{"id":""}]}', '{"data":[{"id":"two words"}]}', '{"data":[{"id":3}]}', JSON.stringify({ data: Array.from({ length: 10001 }, () => ({ id: 'model' })) }), ' '.repeat(1000001)]) {
    body = invalid
    await assert.rejects(ai.listModels(1, input(root)), { code: 'AI_PROTOCOL_ERROR' })
  }
  body = '{"data":[]}'; contentType = 'text/html'
  await assert.rejects(ai.listModels(1, input(root)), { code: 'AI_PROTOCOL_ERROR' })
  contentType = 'application/json'
  await assert.rejects(ai.listModels(1, input(root)), { code: 'AI_PROTOCOL_ERROR' })
  body = JSON.stringify({ data: Array.from({ length: 150 }, (_, i) => ({ id: `model-${i}` })) })
  assert.equal((await ai.listModels(1, input(root))).length, 150)
})

test('model requests time out, cancel only for their owner, enforce per-owner limits and stop on service disposal', async t => {
  const root = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders() })
  const f = fixture(t, root, 50)
  const pending = f.ai.listModels(1, input(root))
  const timedOut = assert.rejects(pending, { code: 'AI_TIMEOUT' })
  assert.throws(() => f.ai.listModels(1, input(root)), { code: 'AI_PROVIDER_FAILED' })
  f.ai.disposeOwner(2)
  await timedOut
  const cancelled = f.ai.listModels(1, input(root))
  const stopped = assert.rejects(cancelled, { code: 'AI_CANCELLED' })
  f.ai.disposeOwner(1); await stopped
  const disposing = f.ai.listModels(2, input(root))
  const rejected = assert.rejects(disposing, { code: 'AI_CANCELLED' })
  await f.ai.dispose(); await rejected
  assert.throws(() => f.ai.listModels(1, input(root)), { code: 'AI_PROVIDER_FAILED' })
})

test('model discovery rejects redirects without forwarding credentials', async t => {
  let forwarded = false
  const target = await server(t, (_req, res) => { forwarded = true; res.end() })
  const source = await server(t, (_req, res) => { res.writeHead(307, { Location: target + '/v1/models' }); res.end() })
  await assert.rejects(fixture(t, source).ai.listModels(1, { ...input(source), apiKey: 'TEMP_KEY' }))
  assert.equal(forwarded, false)
})

test('preload model discovery invokes only the dedicated operation and returns the typed result', async () => {
  const args = input('http://localhost:1234')
  const bridge = createAIBridge(async (operation, value) => {
    assert.equal(operation, 'models'); assert.deepEqual(value, args)
    return { ok: true, value: ['local/model'] }
  }, () => () => {})
  assert.deepEqual(await bridge.listModels(args), { ok: true, value: ['local/model'] })
})
