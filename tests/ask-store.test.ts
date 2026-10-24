import test from 'node:test'
import assert from 'node:assert/strict'
import { AskStore } from '../src/app/ai/askStore'
import type { AskAgentAPI } from '../src/platform/electron/ask-agent-contract'
import type { DataAPI } from '../src/platform/electron/data-contract'
import type { AgentRunEvent, ChatSession, ChatSnapshot } from '../src/domain/chat/chat.types'
const choice = { providerId: 'fixture', modelId: 'model' }, time = '2026-10-24T00:00:00.000Z'
const session: ChatSession = { id: 'session', title: 'Chat', ...choice, createdAt: time, updatedAt: time }
const snapshot = (seq = 0, text = ''): ChatSnapshot => ({ run: { id: 'run', sessionId: 'session', ...choice, state: 'running', error: null, eventSequence: seq, writeStarted: false, createdAt: time, finishedAt: null }, items: [
  { id: 'item', sessionId: 'session', runId: 'run', sequence: 1, content: { type: 'assistant_message', text }, state: 'streaming', createdAt: time, updatedAt: time }
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
  assert.equal(f.starts(), 1); assert.equal(f.store.getSnapshot().drafts.session, '')
  f.dispose()
})
