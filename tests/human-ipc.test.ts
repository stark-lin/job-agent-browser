import test from 'node:test'
import assert from 'node:assert/strict'
import { createHumanRequests } from '../src/platform/mcp/human-requests'
import { createHumanHandler } from '../src/platform/electron/human-handler'
import { createHumanBridge } from '../src/platform/electron/preload/human-bridge'
import { trustedDataSender } from '../src/platform/electron/main/data-ipc'
const signal = () => new AbortController().signal

test('Human IPC rejects untrusted frames, unclaimed/foreign/stale answers and unknown operations', async () => {
  const service = createHumanRequests(), handler = createHumanHandler(service)
  const pending = service.ask('run', { question: 'Direction?', options: ['Backend'] }, signal()), id = service.list()[0].id
  const answer = { id, selectedOption: 'Backend', text: '' }
  for (const sender of [{ windowOwned: false, mainFrame: true, url: 'file:///app.html' }, { windowOwned: true, mainFrame: false, url: 'file:///app.html' }, { windowOwned: true, mainFrame: true, url: 'https://attacker.invalid/' }]) {
    assert.deepEqual(handler.call(1, trustedDataSender(sender, 'file:///app.html'), 'list', {}), { ok: false, error: 'FORBIDDEN' })
  }
  assert.deepEqual(handler.call(1, true, 'answer', answer), { ok: false, error: 'FORBIDDEN' })
  assert(handler.call(1, true, 'list', {}).ok)
  assert.deepEqual(handler.call(2, true, 'answer', answer), { ok: false, error: 'FORBIDDEN' })
  assert.deepEqual(handler.call(1, true, 'profile.update', answer), { ok: false, error: 'INVALID_INPUT' })
  assert.deepEqual(handler.call(1, true, 'answer', { ...answer, extra: true }), { ok: false, error: 'INVALID_INPUT' })
  assert(handler.call(1, true, 'answer', answer).ok)
  assert.deepEqual(await pending, { status: 'submitted', selectedOption: 'Backend', text: '' })
  assert.equal(handler.call(1, true, 'answer', answer).ok, false)
  handler.dispose(); service.dispose()
})

test('renderer lifecycle invalidates pending requests; preload only forwards the human contract', async () => {
  const service = createHumanRequests(), handler = createHumanHandler(service)
  const pending = service.ask('run', { question: 'Direction?' }, signal()), checked = assert.rejects(pending, { code: 'TOOL_CANCELLED' })
  const calls: unknown[] = []
  const bridge = createHumanBridge(async (method, input) => { calls.push([method, input]); const result = handler.call(1, true, method, input); return result as Awaited<ReturnType<Parameters<typeof createHumanBridge>[0]>> }, () => () => {})
  assert((await bridge.list()).ok); handler.disposeOwner(1); await checked
  assert.equal(service.list().length, 0)
  const next = service.ask('next', { question: 'Continue?' }, signal()); await bridge.list()
  await bridge.cancel(service.list()[0].id); assert.deepEqual(await next, { status: 'cancelled' })
  assert.equal(calls.length, 3); handler.dispose(); service.dispose()
})
