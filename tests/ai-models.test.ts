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
function fixture(t: TestContext, baseURL: string, requiresKey = false, timeoutMs = 1000) {
  const settings: AISettings = { providers: [{ id: 'local', name: 'LM Studio', baseURL, requiresKey, models: [], defaultModel: '' }], default: null }
  let keys = 0, audits = 0
  const ai = createAIService({ settings: () => settings, key: () => { keys++; return 'PRIVATE_KEY' }, audit: () => { audits++ }, timeoutMs })
  t.after(() => ai.dispose())
  return { ai, settings, keys: () => keys, audits: () => audits }
}
const input = { providerId: 'local' }

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
    assert.deepEqual(await f.ai.listModels(1, input), ['a-model', 'z/model'])
    assert.deepEqual(f.settings.providers[0].models, [])
    assert.equal(f.keys(), 0); assert.equal(f.audits(), 0)
    const response = await postChat({ provider: f.settings.providers[0], key: null, model: 'a-model' }, { messages: [] }, new AbortController().signal, false)
    await response.body?.cancel()
    assert.deepEqual(requests.slice(-2), [`GET ${path}/models`, `POST ${path}/chat/completions`])
  }
})

test('discovery snapshots saved configuration and credentials without requiring a default or existing models', async t => {
  const root = await server(t, (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer PRIVATE_KEY')
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[{"id":"local/model"}]}')
  })
  const f = fixture(t, root, true)
  const pending = f.ai.listModels(1, input)
  f.settings.providers[0].baseURL = 'http://127.0.0.1:1'
  f.settings.providers[0].requiresKey = false
  assert.deepEqual(await pending, ['local/model'])
  assert.equal(f.keys(), 1); assert.equal(f.audits(), 0)
})

test('invalid inputs and missing provider/key fail before network access', async t => {
  const f = fixture(t, 'http://127.0.0.1:1')
  for (const value of [null, {}, { providerId: '__proto__' }, { ...input, baseURL: 'https://untrusted.example' }, { ...input, apiKey: 'FORGED' }]) {
    assert.throws(() => f.ai.listModels(1, value), { code: 'INVALID_INPUT' })
  }
  assert.throws(() => f.ai.listModels(1, { providerId: 'missing' }), { code: 'AI_NOT_CONFIGURED' })
  const ai = createAIService({ settings: () => ({ ...f.settings, providers: [{ ...f.settings.providers[0], requiresKey: true }] }), key: () => null, audit: () => assert.fail('no generation audit') })
  t.after(() => ai.dispose())
  assert.throws(() => ai.listModels(1, input), { code: 'AI_NOT_CONFIGURED' })
})

test('HTTP model failures use existing sanitized error codes', async t => {
  for (const [status, code] of [[401, 'AI_AUTH_FAILED'], [403, 'AI_AUTH_FAILED'], [429, 'AI_RATE_LIMITED'], [404, 'AI_PROVIDER_FAILED'], [500, 'AI_PROVIDER_FAILED']] as const) {
    const root = await server(t, (_req, res) => { res.writeHead(status); res.end('PRIVATE_PROVIDER_BODY') })
    await assert.rejects(fixture(t, root).ai.listModels(1, input), { code })
  }
})

test('model discovery rejects malformed, oversized and non-JSON responses; an empty model list is valid', async t => {
  let body = '', contentType = 'application/json'
  const root = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': contentType }); res.end(body) })
  const { ai } = fixture(t, root)
  for (const invalid of ['{', 'null', '{}', '{"error":{"message":"PRIVATE"}}', '{"data":[null]}', '{"data":[{"id":""}]}', '{"data":[{"id":"two words"}]}', '{"data":[{"id":3}]}', JSON.stringify({ data: Array.from({ length: 10001 }, () => ({ id: 'model' })) }), ' '.repeat(1000001)]) {
    body = invalid
    await assert.rejects(ai.listModels(1, input), { code: 'AI_PROTOCOL_ERROR' })
  }
  body = '{"data":[]}'; contentType = 'text/html'
  await assert.rejects(ai.listModels(1, input), { code: 'AI_PROTOCOL_ERROR' })
  contentType = 'application/json'
  assert.deepEqual(await ai.listModels(1, input), [])
  body = JSON.stringify({ data: Array.from({ length: 150 }, (_, i) => ({ id: `model-${i}` })) })
  assert.equal((await ai.listModels(1, input)).length, 150)
})

test('model requests time out, cancel only for their owner, enforce per-owner limits and stop on service disposal', async t => {
  const root = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders() })
  const f = fixture(t, root, false, 50)
  const pending = f.ai.listModels(1, input)
  const timedOut = assert.rejects(pending, { code: 'AI_TIMEOUT' })
  assert.throws(() => f.ai.listModels(1, input), { code: 'AI_PROVIDER_FAILED' })
  f.ai.disposeOwner(2)
  await timedOut
  const cancelled = f.ai.listModels(1, input)
  const stopped = assert.rejects(cancelled, { code: 'AI_CANCELLED' })
  f.ai.disposeOwner(1); await stopped
  const disposing = f.ai.listModels(2, input)
  const rejected = assert.rejects(disposing, { code: 'AI_CANCELLED' })
  await f.ai.dispose(); await rejected
  assert.throws(() => f.ai.listModels(1, input), { code: 'AI_PROVIDER_FAILED' })
})

test('model discovery rejects redirects without forwarding credentials', async t => {
  let forwarded = false
  const target = await server(t, (_req, res) => { forwarded = true; res.end() })
  const source = await server(t, (_req, res) => { res.writeHead(307, { Location: target + '/v1/models' }); res.end() })
  await assert.rejects(fixture(t, source, true).ai.listModels(1, input))
  assert.equal(forwarded, false)
})

test('preload model discovery invokes only the dedicated operation and returns the typed result', async () => {
  const bridge = createAIBridge(async (operation, value) => {
    assert.equal(operation, 'models'); assert.deepEqual(value, input)
    return { ok: true, value: ['local/model'] }
  }, () => () => {})
  assert.deepEqual(await bridge.listModels(input), { ok: true, value: ['local/model'] })
})
