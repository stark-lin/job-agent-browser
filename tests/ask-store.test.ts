import test from 'node:test'
import assert from 'node:assert/strict'
import { AskStore } from '../src/app/ai/askStore'
import type { AskAgentAPI } from '../src/platform/electron/ask-agent-contract'
import type { DataAPI } from '../src/platform/electron/data-contract'
import type { AgentRunEvent, ChatSession, ChatSnapshot } from '../src/domain/chat/chat.types'
import type { WebSelection } from '../src/shared/browser-selection'
const choice = { providerId: 'fixture', modelId: 'model' }, time = '2026-10-24T00:00:00.000Z'
const session: ChatSession = { id: 'session', title: 'Chat', ...choice, createdAt: time, updatedAt: time }
const snapshot = (seq = 0, text = ''): ChatSnapshot => ({ run: { id: 'run', sessionId: 'session', ...choice, state: 'running', error: null, eventSequence: seq, writeStarted: false, createdAt: time, finishedAt: null }, items: [
  { id: 'item', sessionId: 'session', runId: 'run', sequence: 1, phase: 'execute', content: { type: 'assistant_message', text }, state: 'streaming', createdAt: time, updatedAt: time }
] })
const delta = (eventSequence: number, text: string): AgentRunEvent => ({ type: 'item.delta', runId: 'run', sessionId: 'session', itemId: 'item', eventSequence, delta: text })
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture(getRun: AskAgentAPI['getRun']) {
  let receive!: (event: AgentRunEvent) => void, starts = 0
  const api: AskAgentAPI = { getRun, listActive: async () => ({ ok: true, value: [] }), onEvent: callback => { receive = callback; return () => {} }, cancel: async () => ({ ok: true, value: null }), start: async () => { starts++; return { ok: true, value: { sessionId: 'session', runId: 'run' } } } }
  const data = { chats: { listSessions: async () => ({ ok: true, value: { items: [session], total: 1 } }), listItems: async () => ({ ok: true, value: { items: [], total: 0 } }), listRuns: async () => ({ ok: true, value: { items: [], total: 0 } }) } } as unknown as DataAPI
  const store = new AskStore(api, data), dispose = store.start()
  return { store, receive: (event: AgentRunEvent) => receive(event), dispose, starts: () => starts }
}
test('Ask projection buffers early events, applies snapshot watermarks and ignores duplicates or stale deltas', async () => {
  let resolve!: (value: Awaited<ReturnType<AskAgentAPI['getRun']>>) => void
  const f = fixture(() => new Promise(r => { resolve = r }))
  await tick(); f.receive(delta(2, 'B')); f.receive(delta(3, 'C'))
  resolve({ ok: true, value: snapshot(2, 'AB') }); await tick()
  let item = f.store.getSnapshot().items.session[0]; assert(item.content.type !== 'tool_call'); assert.equal(item.content.text, 'ABC')
  f.receive(delta(3, 'C')); f.receive(delta(1, 'A')); item = f.store.getSnapshot().items.session[0]
  assert(item.content.type !== 'tool_call'); assert.equal(item.content.text, 'ABC')
  f.dispose()
})
test('event gaps trigger resync; an unavailable snapshot does not create a retry loop', async () => {
  let reads = 0
  const f = fixture(async () => { reads++; return reads === 1 ? { ok: true, value: snapshot(1, 'A') } : { ok: false, error: 'FORBIDDEN' } })
  await tick(); f.receive(delta(1, 'A')); await tick(); f.receive(delta(5, 'gap')); await tick(); await tick()
  assert.equal(reads, 2); assert.equal(f.store.getSnapshot().error, 'FORBIDDEN'); f.dispose()
})
test('page switching preserves drafts and does not cancel active work; rapid sends are deduplicated', async () => {
  const f = fixture(async () => ({ ok: true, value: snapshot() }))
  await tick(); f.store.select('session'); f.store.setDraft('Draft A'); f.store.select(null); f.store.setDraft('New chat')
  assert.equal(f.store.getSnapshot().drafts.session, 'Draft A')
  await Promise.all([f.store.send(choice), f.store.send(choice)])
  assert.equal(f.starts(), 1); assert.equal(f.store.getSnapshot().drafts.session, 'Draft A')
  f.dispose()
})

const selection: WebSelection = { id: 'selection', target: 'ask-ai', text: 'Engineer\nTypeScript 中文', source: { url: 'https://example.com/jobs/123', title: 'Engineer' } }
test('web selection appends once to the new draft, protects session drafts and creates no run', async () => {
  const f = fixture(async () => ({ ok: true, value: snapshot() }))
  try {
    await tick(); f.store.setDraft('Existing new draft'); f.store.select('session'); f.store.setDraft('Existing session draft')
    f.store.insertWebSelection(selection); f.store.insertWebSelection(selection)
    const state = f.store.getSnapshot()
    assert.equal(state.activeId, null); assert.equal(state.drafts.session, 'Existing session draft')
    assert(state.drafts.draft.startsWith('Existing new draft\n\n---\n\n'))
    assert(state.drafts.draft.includes(selection.source.url)); assert(state.drafts.draft.includes('> TypeScript 中文'))
    assert.equal(state.drafts.draft.split(selection.source.url).length, 2); assert.equal(f.starts(), 0)
  } finally { f.dispose() }
})
test('over-limit selection retains the draft and can be retried after editing', async () => {
  const f = fixture(async () => ({ ok: true, value: snapshot() }))
  try {
    await tick(); f.store.setDraft('x'.repeat(127999))
    assert.throws(() => f.store.insertWebSelection(selection), /SELECTION_TOO_LARGE/)
    assert.equal(f.store.getSnapshot().drafts.draft.length, 127999)
    f.store.setDraft('Shortened'); f.store.insertWebSelection(selection)
    assert(f.store.getSnapshot().drafts.draft.includes(selection.source.url)); assert.equal(f.starts(), 0)
  } finally { f.dispose() }
})
test('an in-flight send cannot reclaim or erase a transferred new-chat draft', async () => {
  let finish!: (value: Awaited<ReturnType<AskAgentAPI['start']>>) => void
  const api: AskAgentAPI = { onEvent: () => () => {}, cancel: async () => ({ ok: true, value: null }), listActive: async () => ({ ok: true, value: [] }),
    start: () => new Promise(resolve => { finish = resolve }), getRun: async () => ({ ok: true, value: snapshot() }) }
  const data = { chats: { listSessions: async () => ({ ok: true, value: { items: [session], total: 1 } }) } } as unknown as DataAPI
  const store = new AskStore(api, data), dispose = store.start()
  try {
    await tick(); store.setDraft('Sending this'); const sent = store.send(choice)
    store.insertWebSelection(selection)
    finish({ ok: true, value: { sessionId: 'session', runId: 'run' } }); await sent
    assert.equal(store.getSnapshot().activeId, null)
    assert(store.getSnapshot().drafts.draft.includes(selection.source.url))
  } finally { dispose() }
})
