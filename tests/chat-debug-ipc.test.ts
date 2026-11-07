import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { composeBackend } from '../src/platform/database/backend'
import { openDatabase } from '../src/platform/database/sqlite'
import { createDataBridge } from '../src/platform/electron/preload/data-bridge'
import { createChatDebugOutput } from '../src/platform/electron/main/chat-debug-output'
import type { ChatDebugOutput } from '../src/domain/chat/chat-debug.types'

const app = { version: '1.2.3', commit: 'a'.repeat(40), platform: 'darwin' }, now = '2026-11-04T00:00:00.000Z'
const choice = { providerId: 'test', modelId: 'fixture' }
function setup(t: { after(fn: () => void): void }, output?: ChatDebugOutput) {
  const database = openDatabase(':memory:'), backend = composeBackend(database, undefined, 'internal', { chatDebugOutput: output })
  t.after(() => backend.close())
  const api = createDataBridge(async (group, method, input) => backend.dispatch(group, method, input))
  const ids = backend.chats.start({ requestId: randomUUID(), message: 'PRIVATE_DEBUG_CONTENT', choice })
  const unchanged = () => JSON.stringify(database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => [r.name, database.connection.prepare(`SELECT * FROM "${r.name}" ORDER BY rowid`).all()]))
  return { database, backend, api, ids, unchanged }
}

test('Data allowlist and generic dispatcher await host copy and return only null after exact readback', async t => {
  let text = '', reads = 0
  const output = createChatDebugOutput({ async writeText(value) { text = value }, async readText() { reads++; return text } }, app, () => now)
  const f = setup(t, output), before = f.unchanged()
  const result = await f.api.chats.copyDebugJson({ sessionId: f.ids.sessionId })
  assert.deepEqual(result, { ok: true, value: null }); assert.equal(reads, 1)
  const bundle = JSON.parse(text)
  assert.equal(bundle.format, 'jab-debug'); assert.equal(bundle.schemaVersion, 2); assert.equal(bundle.exportedAt, now); assert.deepEqual(bundle.app, app)
  assert.equal(bundle.session.id, f.ids.sessionId); assert.equal(bundle.runs[0].run.id, f.ids.runId)
  assert.equal(JSON.parse(bundle.runs[0].items[0].content_json).text, 'PRIVATE_DEBUG_CONTENT')
  assert.equal(text, JSON.stringify(bundle, null, 2)); assert.equal(f.unchanged(), before)
  assert(!JSON.stringify(result).includes('PRIVATE_DEBUG_CONTENT'))
  for (const [group, method] of [['chats', 'getDebugBundle'], ['chats', 'copy'], ['chats', '__proto__'], ['copyDebugJson', 'chats']]) assert.deepEqual(await f.backend.dispatch(group, method, {}), { ok: false, error: 'INVALID_INPUT' })
  for (const input of [{}, { sessionId: 'bad' }, { sessionId: f.ids.sessionId, extra: 'PRIVATE' }]) assert.deepEqual(await f.backend.dispatch('chats', 'copyDebugJson', input), { ok: false, error: 'INVALID_INPUT' })
  assert.deepEqual(await f.api.chats.copyDebugJson({ sessionId: randomUUID() }), { ok: false, error: 'NOT_FOUND' })
  assert.equal(reads, 1); assert.equal(f.unchanged(), before)
})

test('missing host fails before any debug SELECT, with old backend callers remaining synchronous', async t => {
  const f = setup(t)
  t.mock.method(f.database.connection, 'prepare', () => { assert.fail('no debug read without output') })
  assert.deepEqual(await f.api.chats.copyDebugJson({ sessionId: f.ids.sessionId }), { ok: false, error: 'NOT_IMPLEMENTED' })
  t.mock.restoreAll()
  assert.equal(f.backend.dispatch('chats', 'getSession', { id: f.ids.sessionId }).ok, true)
})

for (const failure of ['serialize', 'write', 'read', 'mismatch', 'storage'] as const) test(`Data dispatcher contains ${failure} failures without data or exception leakage or writes`, async t => {
  let text = '', writes = 0
  const output = createChatDebugOutput({ async writeText(value) { writes++; if (failure === 'write') throw new Error('PRIVATE_WRITE'); text = value },
    async readText() { if (failure === 'read') throw new Error('PRIVATE_READ'); return failure === 'mismatch' ? text.slice(1) : text } }, app, () => {
    if (failure === 'serialize') throw new Error('PRIVATE_SERIALIZATION')
    return now
  })
  const f = setup(t, output), before = f.unchanged()
  if (failure === 'storage') {
    const prepare = f.database.connection.prepare.bind(f.database.connection)
    t.mock.method(f.database.connection, 'prepare', ((sql: string) => { if (sql.startsWith('SELECT * FROM chat_sessions')) throw new Error('PRIVATE_SQL'); return prepare(sql) }) as typeof f.database.connection.prepare)
  }
  const result = await f.api.chats.copyDebugJson({ sessionId: f.ids.sessionId })
  assert.deepEqual(result, { ok: false, error: failure === 'serialize' ? 'DEBUG_SERIALIZATION_FAILED' : failure === 'storage' ? 'STORAGE_UNAVAILABLE' : 'CLIPBOARD_FAILED' })
  if (failure === 'serialize' || failure === 'storage') assert.equal(writes, 0)
  t.mock.restoreAll(); assert.equal(f.unchanged(), before); assert.equal(f.database.connection.isTransaction, false)
})

test('JSON stringify rejection is classified before writing any clipboard data', async () => {
  let writes = 0
  const output = createChatDebugOutput({ async writeText() { writes++ }, async readText() { return '' } }, app)
  const data = { session: { toJSON() { throw new Error('PRIVATE_JSON') } } } as unknown as Parameters<ChatDebugOutput['copy']>[0]
  await assert.rejects(() => output.copy(data), { code: 'DEBUG_SERIALIZATION_FAILED' }); assert.equal(writes, 0)
})
