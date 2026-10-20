import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture, value } from './helpers'
import { createProfileImporter } from '../src/platform/profile-import/service'
import type { AIService } from '../src/platform/ai'
import type { AIEvent } from '../src/shared/ai'
import type { ImportEvent } from '../src/platform/electron/profile-import-contract'
import type { ConfirmedImport, ImportDraft, ImportSaved } from '../src/domain/candidate/import.types'
import type { Result } from '../src/shared/ipc'

const pages = [{ page: 1, text: 'First fact\nSecond fact' }]
const response = JSON.stringify({ contact: { name: 'Candidate' }, links: [], items: [{ type: 'PROJECT', title: 'Project',
  facts: ['First fact', 'Second fact'].map(content => ({ kind: 'ACHIEVEMENT', content, source: { page: 1, quote: content } })) }], facts: [] })
const choice = { providerId: 'fixture', modelId: 'fixture' }
function aiFixture(automatic = true) {
  let emit: ((event: AIEvent) => void) | undefined
  const id = randomUUID(), cancelled: string[] = []
  const ai: Pick<AIService, 'start' | 'cancel'> = {
    start(_owner, _input, callback) {
      emit = callback
      if (automatic) setImmediate(() => { callback({ requestId: id, type: 'delta', text: response }); callback({ requestId: id, type: 'completed' }) })
      return { requestId: id }
    }, cancel(_owner, id) { cancelled.push(id) }
  }
  return { ai, cancelled, late() { emit?.({ requestId: id, type: 'delta', text: response }); emit?.({ requestId: id, type: 'completed' }) } }
}
async function ready(importer: ReturnType<typeof createProfileImporter>, owner: number, fileId: string) {
  let resolve!: (event: ImportEvent & { type: 'ready' }) => void
  const done = new Promise<ImportEvent & { type: 'ready' }>(value => { resolve = value })
  const task = importer.start(owner, { fileId, choice }, event => { if (event.type === 'ready') resolve(event) })
  const result = await done
  return { ...task, draft: result.draft }
}
function selection(draft: ImportDraft, sessionId: string): ConfirmedImport {
  return { sessionId, batchId: randomUUID(), profileId: null, contact: { name: 'Candidate' }, links: [], items: draft.items.map(({ draftId, details }) => ({ draftId, details })),
    facts: [draft.facts[0]].map(({ draftId, itemDraftId, details }) => ({ draftId, itemDraftId, details, profileItemId: null })) }
}
test('session saves parent once, attaches remaining facts later and replays uncertain saves without duplicate writes', async t => {
  const f = fixture(t), mock = aiFixture()
  const importer = createProfileImporter({ ai: mock.ai, extract: async () => structuredClone(pages), apply: input => f.backend.dispatch('profiles', 'applyConfirmedImport', input) as Result<ImportSaved> })
  t.after(() => importer.dispose())
  const file = importer.select(1, new Uint8Array([1])), task = await ready(importer, 1, file.fileId), first = selection(task.draft, task.sessionId)
  const saved = value(importer.apply(1, first)), count = value(await f.api.audit.list({})).total
  assert.deepEqual(value(importer.apply(1, first)), saved)
  assert.equal(value(await f.api.audit.list({})).total, count)
  assert.throws(() => importer.apply(1, { ...first, contact: { name: 'Different' } }), /CONFLICT/)
  assert.throws(() => importer.apply(1, { ...first, batchId: randomUUID(), profileId: saved.profile.id }), /CONFLICT/)
  const { draftId, itemDraftId, details } = task.draft.facts[1]
  const second: ConfirmedImport = { ...first, batchId: randomUUID(), profileId: saved.profile.id, contact: {}, items: [], facts: [{ draftId, itemDraftId, details, profileItemId: null }] }
  const later = value(importer.apply(1, second))
  assert.equal(later.items.length, 0); assert.equal(later.facts[0].profileItemId, saved.items[0].id)
  assert.equal(value(await f.api.profiles.listItems({ profileId: saved.profile.id })).total, 1)
  assert.equal(value(await f.api.profiles.listFacts({ profileId: saved.profile.id })).total, 2)
})
test('file/task ownership is enforced and deleted saved parents block later facts', async t => {
  const f = fixture(t), mock = aiFixture(), importer = createProfileImporter({ ai: mock.ai, extract: async () => structuredClone(pages), apply: input => f.backend.dispatch('profiles', 'applyConfirmedImport', input) as Result<ImportSaved> })
  t.after(() => importer.dispose())
  const file = importer.select(1, new Uint8Array([1]))
  assert.throws(() => importer.start(2, { fileId: file.fileId, choice }, () => {}), /FORBIDDEN/)
  const task = await ready(importer, 1, file.fileId), first = selection(task.draft, task.sessionId)
  assert.throws(() => importer.apply(2, first), /FORBIDDEN/)
  assert.throws(() => importer.cancel(2, { sessionId: task.sessionId }), /FORBIDDEN/)
  assert.throws(() => importer.discard(2, { fileId: file.fileId }), /FORBIDDEN/)
  const saved = value(importer.apply(1, first))
  value(await f.api.profiles.deleteItem({ id: saved.items[0].id }))
  const { draftId, itemDraftId, details } = task.draft.facts[1]
  const next = { ...first, batchId: randomUUID(), profileId: saved.profile.id, contact: {}, items: [], facts: [{ draftId, itemDraftId, details, profileItemId: null }] }
  assert.deepEqual(importer.apply(1, next), { ok: false, error: 'NOT_FOUND' })
  assert.equal(value(await f.api.profiles.listFacts({ profileId: saved.profile.id })).total, 0)
})
test('cancel/discard suppress late AI results and release sessions', async () => {
  const mock = aiFixture(false), importer = createProfileImporter({ ai: mock.ai, extract: async () => structuredClone(pages), apply: () => assert.fail('must not save') })
  const file = importer.select(1, new Uint8Array([1])), events: ImportEvent[] = []
  const task = importer.start(1, { fileId: file.fileId, choice }, event => events.push(event))
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve))
  importer.cancel(1, { sessionId: task.sessionId }); mock.late()
  assert.equal(events.filter(event => event.type === 'ready').length, 0); assert.equal(mock.cancelled.length, 1)
  importer.discard(1, { sessionId: task.sessionId })
  assert.throws(() => importer.cancel(1, { sessionId: task.sessionId }), /IMPORT_NOT_FOUND/)
  importer.dispose()
})
test('uploading identical content again creates new IDs after explicit confirmation', async t => {
  const f = fixture(t), mock = aiFixture(), importer = createProfileImporter({ ai: mock.ai, extract: async () => structuredClone(pages), apply: input => f.backend.dispatch('profiles', 'applyConfirmedImport', input) as Result<ImportSaved> })
  t.after(() => importer.dispose())
  const one = importer.select(1, new Uint8Array([1])), first = await ready(importer, 1, one.fileId)
  const saved = value(importer.apply(1, selection(first.draft, first.sessionId)))
  const two = importer.select(1, new Uint8Array([1])), second = await ready(importer, 1, two.fileId)
  const input = selection(second.draft, second.sessionId); input.profileId = saved.profile.id
  const again = value(importer.apply(1, input))
  assert.notEqual(again.items[0].id, saved.items[0].id)
  assert.equal(value(await f.api.profiles.listItems({ profileId: saved.profile.id })).total, 2)
})
test('AI failures and malformed output require an explicit retry and do not write profile data', async () => {
  let calls = 0, completed!: (event: ImportEvent) => void
  const ai: Pick<AIService, 'start' | 'cancel'> = {
    start(_owner, _input, emit) {
      const requestId = randomUUID(); calls++
      setImmediate(() => {
        if (calls === 1) emit({ requestId, type: 'failed', error: 'AI_RATE_LIMITED' })
        else { emit({ requestId, type: 'delta', text: '{invalid JSON' }); emit({ requestId, type: 'completed' }) }
      })
      return { requestId }
    }, cancel() {}
  }
  const importer = createProfileImporter({ ai, extract: async () => structuredClone(pages), apply: () => assert.fail('no unconfirmed writes') })
  const file = importer.select(1, new Uint8Array([1]))
  const failure = () => new Promise<ImportEvent>(resolve => { completed = resolve })
  let done = failure()
  importer.start(1, { fileId: file.fileId, choice }, event => { if (event.type === 'failed') completed(event) })
  assert.deepEqual((await done as { error: string }).error, 'AI_RATE_LIMITED'); assert.equal(calls, 1)
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1, 'no automatic retry')
  done = failure()
  importer.start(1, { fileId: file.fileId, choice }, event => { if (event.type === 'failed') completed(event) })
  assert.deepEqual((await done as { error: string }).error, 'IMPORT_INVALID_OUTPUT'); assert.equal(calls, 2)
  importer.dispose()
})
test('discard during extraction suppresses a late worker result before any AI request', async () => {
  let finish!: (value: typeof pages) => void
  const importer = createProfileImporter({ ai: { start() { return assert.fail('must not call AI') }, cancel() {} },
    extract: () => new Promise(resolve => { finish = resolve }), apply: () => assert.fail('must not save') })
  const file = importer.select(1, new Uint8Array([1])), events: ImportEvent[] = []
  const task = importer.start(1, { fileId: file.fileId, choice }, event => events.push(event))
  await new Promise(resolve => setImmediate(resolve))
  importer.discard(1, { sessionId: task.sessionId }); finish(structuredClone(pages))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(events.filter(event => event.type === 'ready').length, 0)
  importer.dispose()
})
