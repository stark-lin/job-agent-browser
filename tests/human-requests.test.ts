import test from 'node:test'
import assert from 'node:assert/strict'
import { createHumanRequests } from '../src/platform/mcp/human-requests'
const signal = () => new AbortController().signal

for (const options of [undefined, [], ['Backend', 'Full stack']]) test(`Human Ask accepts text, selection and both (${JSON.stringify(options)})`, async () => {
  const service = createHumanRequests()
  for (const answer of [{ selectedOption: null, text: 'My answer' }, ...(options?.length ? [{ selectedOption: options[0], text: '' }, { selectedOption: options[0], text: 'Context' }] : [])]) {
    const pending = service.ask('run', { question: 'Which direction?', ...(options ? { options } : {}) }, signal())
    const request = service.list()[0]
    assert.throws(() => service.answer(request.id, { selectedOption: null, text: '  ' }), { code: 'TOOL_INVALID_INPUT' })
    assert.throws(() => service.answer(request.id, { selectedOption: 'Unknown', text: '' }), { code: 'TOOL_INVALID_INPUT' })
    service.answer(request.id, answer); assert.deepEqual(await pending, { status: 'submitted', ...answer })
    assert.throws(() => service.answer(request.id, answer), { code: 'TOOL_NOT_FOUND' })
  }
  service.dispose()
})

test('user cancellation is an answer, while Run/window/disposal cancellation invalidates the call', async () => {
  const service = createHumanRequests(), controller = new AbortController()
  let changes = 0; const unsubscribe = service.subscribe(() => { changes++ })
  const cancelled = service.ask('run', { question: 'Continue?' }, signal())
  assert.throws(() => service.ask('run', { question: 'Duplicate?' }, signal()), { code: 'TOOL_BUSY' })
  service.cancel(service.list()[0].id); assert.deepEqual(await cancelled, { status: 'cancelled' })
  const aborted = service.ask('run', { question: 'Continue?' }, controller.signal)
  const checked = assert.rejects(aborted, { code: 'TOOL_CANCELLED' }); controller.abort(); await checked
  const window = service.ask('run', { question: 'Continue?' }, signal()), invalid = assert.rejects(window, { code: 'TOOL_CANCELLED' })
  service.invalidate(service.list()[0].id); await invalid
  const disposed = service.ask('run', { question: 'Continue?' }, signal()), check = assert.rejects(disposed, { code: 'TOOL_CANCELLED' })
  service.dispose(); await check; assert.equal(service.list().length, 0); assert(changes >= 8); unsubscribe()
})

for (const input of [{}, { question: '' }, { question: '  ' }, { question: 'Q', options: [3] }, { question: 'Q', options: ['A', 'A'] }, { question: 'Q', extra: true }]) test(`Human Ask rejects malformed input ${JSON.stringify(input)}`, () => {
  const service = createHumanRequests(); assert.throws(() => service.ask('run', input, signal()), { code: 'TOOL_INVALID_INPUT' }); service.dispose()
})
