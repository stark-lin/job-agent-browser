import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createImportBatch } from '../src/platform/import/batch'
import { createJobImporter } from '../src/platform/job-import/service'
import { createProfileImporter } from '../src/platform/profile-import/service'
import { jobParts, mergeJobParts } from '../src/platform/job-import/parts'
import { profileParts, mergeProfileParts } from '../src/platform/profile-import/parts'
import { aiPreferences } from '../src/platform/storage/ai-preferences'
import { allowsParallelImport, type AIEvent, type AISettings } from '../src/shared/ai'
import type { ImportGroupProgress } from '../src/shared/import'
import type { AIService } from '../src/platform/ai'
import type { AgentModel } from '../src/shared/agent'
import { DataError } from '../src/domain/common/errors'
import type { JobImportEvent } from '../src/platform/electron/job-import-contract'
import type { ImportEvent } from '../src/platform/electron/profile-import-contract'

const choice = { providerId: 'fixture', modelId: 'fixture' }
const settings: AISettings = { providers: [{ id: 'fixture', name: 'Fixture', baseURL: 'http://127.0.0.1', requiresKey: false,
  models: ['fixture', 'other'], defaultModel: 'fixture', parallelModels: ['fixture'] }], default: choice }
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const snapshot = { requestedUrl: 'https://example.com/job', url: 'https://example.com/job', pageTitle: 'Job', cleanedContent: 'Job text', jobPosting: [] }
const pages = [{ page: 1, text: 'Candidate built services and studied computing.' }]
function mockAI(beginImmediately = true) {
  const calls: { id: string; prompt: string; emit: (event: AIEvent) => void; begin: () => void }[] = [], cancelled: string[] = []
  const ai: Pick<AIService, 'start' | 'cancel'> = {
    start(_owner, input, emit, options) {
      const id = randomUUID(), prompt = input as { messages: { content: string }[] }
      const begin = () => options?.onRunning()
      calls.push({ id, prompt: prompt.messages[0].content, emit, begin }); if (beginImmediately) begin()
      return { requestId: id }
    }, cancel(_owner, id) { cancelled.push(id) }
  }
  const finish = (index: number, output: unknown) => {
    const { id: requestId, emit } = calls[index]
    emit({ requestId, type: 'delta', text: JSON.stringify(output) }); emit({ requestId, type: 'completed' })
  }
  const fail = (index: number) => calls[index].emit({ requestId: calls[index].id, type: 'failed', error: 'AI_RATE_LIMITED' })
  const model: AgentModel = { complete: input => new Promise((resolve, reject) => {
    let output = ''
    ai.start(1, { choice, messages: input.messages.filter(message => message.role === 'user') }, event => {
      if (event.type === 'delta') output += event.text
      else if (event.type === 'completed') resolve({ content: output, toolCalls: [] })
      else if (event.type === 'failed') reject(new DataError(event.error))
    })
  }) }
  return { ai, model, calls, finish, fail, cancelled }
}

test('parallel opt-in is scoped to provider/model, validated and backward compatible', () => {
  assert(allowsParallelImport(aiPreferences(settings), choice))
  assert(!allowsParallelImport(settings, { ...choice, modelId: 'other' }))
  assert(!allowsParallelImport(settings, { ...choice, providerId: 'different' }))
  const legacy = structuredClone(settings); delete legacy.providers[0].parallelModels
  assert(!allowsParallelImport(aiPreferences(legacy), choice))
  for (const parallelModels of [['absent'], ['fixture', 'fixture'], true]) {
    assert.throws(() => aiPreferences({ ...settings, providers: [{ ...settings.providers[0], parallelModels }] }), /INVALID_INPUT/)
  }
})

test('batch bounds concurrency, merges in definition order and retries only failed parts', async () => {
  const mock = mockAI(), updates: ImportGroupProgress[][] = []
  const batch = createImportBatch(mock.ai, 1, choice, (['contact', 'experience', 'projects', 'education'] as const).map(id => ({
    id, prompt: id, parse: (text: string) => JSON.parse(text) as string
  })))
  const pending = batch.run(new AbortController().signal, groups => updates.push(groups))
  assert.equal(mock.calls.length, 3)
  mock.finish(2, 'project'); await tick(); assert.equal(mock.calls.length, 4)
  mock.finish(3, 'education'); mock.fail(1); mock.finish(0, 'contact')
  await assert.rejects(pending, /AI_RATE_LIMITED/)
  assert(batch.retryable); assert.equal(updates.at(-1)?.filter(group => group.state === 'completed').length, 3)
  const retry = batch.run(new AbortController().signal, groups => updates.push(groups))
  assert.equal(mock.calls.length, 5); assert.equal(mock.calls[4].prompt, 'experience')
  mock.finish(4, 'experience')
  assert.deepEqual(await retry, ['contact', 'experience', 'project', 'education'])
  assert(!batch.retryable); assert(updates.at(-1)?.every(group => group.elapsedMs >= 0 && group.queueMs >= 0))
})

test('batch cancellation stops active requests, suppresses late output and never launches queued parts', async () => {
  const mock = mockAI(), controller = new AbortController()
  const batch = createImportBatch(mock.ai, 1, choice, (['contact', 'experience', 'projects', 'education'] as const).map(id => ({
    id, prompt: id, parse: (text: string) => text
  })))
  const pending = batch.run(controller.signal, () => {})
  controller.abort()
  await assert.rejects(pending)
  assert.equal(mock.cancelled.length, 3); assert.equal(mock.calls.length, 3)
  for (let i = 0; i < 3; i++) mock.finish(i, 'late')
  assert.equal(mock.calls.length, 3)
})

test('job groups enforce field ownership and salary rules and match single-request drafts', () => {
  const parts = jobParts(snapshot, 'parallel')
  const basic = { title: 'Engineer', companyNameRaw: 'Company', salary: { min: 100, max: 200, currency: 'AUD', period: 'YEAR', text: '' } }
  const description = { description: 'Build services' }, requirements = { requirements: [{ text: 'SQL', type: 'REQUIRED', keywords: ['SQL'] }] }
  const merged = mergeJobParts(parts.map((part, index) => part.parse(JSON.stringify([basic, description, requirements][index]))))
  const single = jobParts(snapshot, 'single')[0].parse(JSON.stringify({ ...basic, ...description, ...requirements }))
  assert.deepEqual(merged, single)
  assert.throws(() => parts[0].parse('{"description":"wrong owner"}'), /JOB_INVALID_OUTPUT/)
  assert.throws(() => parts[0].parse(JSON.stringify({ ...basic, salary: { ...basic.salary, min: 300 } })), /JOB_INVALID_OUTPUT/)
  assert.throws(() => mergeJobParts(parts.map(part => part.parse('{}'))), /JOB_NO_CONTENT/)
})

test('job retries keep the source and model, enforce ownership and expose no partial draft', async () => {
  const mock = mockAI(), events: JobImportEvent[] = []; let reads = 0
  const config = structuredClone(settings)
  const importer = createJobImporter({ model: () => mock.model, mcp: { session: async () => assert.fail('Capture must not connect during parsing'), dispose: async () => {} }, settings: () => config, reader: { read: async () => { reads++; return snapshot } } })
  assert.throws(() => importer.start(1, { url: snapshot.url, choice: { ...choice, modelId: 'other' }, mode: 'parallel' }, () => {}), /INVALID_INPUT/)
  const task = importer.start(1, { url: snapshot.url, choice, mode: 'parallel' }, event => events.push(event))
  await tick(); assert.equal(mock.calls.length, 3)
  mock.finish(2, { requirements: [] }); mock.fail(1); mock.finish(0, { title: 'Engineer' }); await tick()
  assert(!events.some(event => event.type === 'ready')); assert.equal(events.at(-1)?.type, 'failed')
  assert.throws(() => importer.retry(2, task), /FORBIDDEN/)
  config.providers[0].parallelModels = []; config.default = null
  importer.retry(1, task); await tick()
  assert.equal(mock.calls.length, 4); assert.equal(reads, 1)
  mock.finish(3, { description: 'Build services' }); await tick()
  const ready = events.find(event => event.type === 'ready')
  assert(ready?.type === 'ready'); assert.equal(ready.draft.details.title, 'Engineer'); assert.equal(ready.draft.details.description, 'Build services')
  importer.dispose()
})

test('profile groups keep facts with parents, reject wrong groups and deduplicate only exact statements', () => {
  const parts = profileParts(pages, 'parallel'), fact = { kind: 'ACHIEVEMENT', content: 'Built services' }
  const values = [
    { contact: { name: 'Candidate' }, links: [], facts: [fact, { kind: 'SKILL', content: 'SQL' }] },
    { items: [{ type: 'EXPERIENCE', title: 'Engineer', facts: [fact, fact] }] },
    { items: [{ type: 'PROJECT', title: 'Project', facts: [fact] }] }, { items: [] }
  ]
  const merged = mergeProfileParts(parts.map((part, index) => part.parse(JSON.stringify(values[index]))))
  assert.equal(merged.items.length, 2); assert.equal(merged.facts.length, 3)
  assert.equal(merged.facts.filter(entry => entry.itemDraftId).length, 2)
  assert.notEqual(merged.facts[0].itemDraftId, merged.facts[1].itemDraftId)
  assert(merged.facts.every(entry => !('evidence' in entry.details) && !('sourceError' in entry)))
  assert.throws(() => parts[1].parse(JSON.stringify(values[2])), /IMPORT_INVALID_OUTPUT/)
  assert.throws(() => parts[0].parse('{"contact":{},"links":[],"facts":[],"items":[]}'), /IMPORT_INVALID_OUTPUT/)
})

test('profile retry preserves extraction and successful groups and cancellation suppresses late drafts', async () => {
  const mock = mockAI(), events: ImportEvent[] = []; let extractions = 0
  const importer = createProfileImporter({ ai: mock.ai, settings: () => settings, extract: async () => { extractions++; return pages }, apply: () => assert.fail('no implicit writes') })
  const file = importer.select(1, new Uint8Array([1]))
  const task = importer.start(1, { fileId: file.fileId, choice, mode: 'parallel' }, event => events.push(event))
  await tick(); assert.equal(mock.calls.length, 3)
  mock.finish(0, { contact: { name: 'Candidate' }, links: [], facts: [] }); await tick()
  assert.equal(mock.calls.length, 4)
  mock.fail(1); mock.finish(2, { items: [{ type: 'PROJECT', title: 'Project', facts: [{ kind: 'SKILL', content: 'SQL' }] }] }); mock.finish(3, { items: [] }); await tick()
  assert.equal(events.at(-1)?.type, 'failed'); assert(!events.some(event => event.type === 'ready'))
  assert.throws(() => importer.retry(2, { sessionId: task.sessionId }), /FORBIDDEN/)
  const retried = importer.retry(1, { sessionId: task.sessionId }); assert.notEqual(retried.taskId, task.taskId)
  await tick(); assert.equal(mock.calls.length, 5); assert.equal(extractions, 1)
  mock.finish(4, { items: [] }); await tick()
  const ready = events.find(event => event.type === 'ready')
  assert(ready?.type === 'ready'); assert.equal(ready.draft.items[0].details.title, 'Project')
  importer.discard(1, { sessionId: task.sessionId })
  const nextFile = importer.select(1, new Uint8Array([2]))
  const next = importer.start(1, { fileId: nextFile.fileId, choice, mode: 'parallel' }, event => events.push(event))
  await tick(); importer.cancel(1, { sessionId: next.sessionId })
  for (let index = 5; index < mock.calls.length; index++) mock.finish(index, {})
  await tick(); assert.equal(events.at(-1)?.type, 'cancelled'); assert.equal(mock.cancelled.length, 3)
  importer.dispose()
})

test('timers advance for service-queued, locally queued and running groups without model output, then freeze on completion', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const advance = (ms: number) => { now += ms; t.mock.timers.tick(ms) }
  const mock = mockAI(false), updates: ImportGroupProgress[][] = []
  const batch = createImportBatch(mock.ai, 1, choice, (['contact', 'experience', 'projects', 'education'] as const).map(id => ({ id, prompt: id, parse: (text: string) => text })))
  const pending = batch.run(new AbortController().signal, groups => updates.push(groups))
  t.after(() => { for (let index = 0; index < mock.calls.length; index++) mock.finish(index, 'cleanup') })
  advance(400)
  assert(updates.at(-1)?.every(group => group.state === 'queued' && group.queueMs === 400 && group.elapsedMs === 0))
  mock.calls[0].begin(); advance(300)
  assert.equal(updates.at(-1)?.[0].elapsedMs, 300); assert.equal(updates.at(-1)?.[0].queueMs, 400)
  assert.equal(updates.at(-1)?.[3].queueMs, 700)
  mock.finish(0, 'contact'); await tick(); advance(200)
  assert.equal(mock.calls.length, 4)
  assert.equal(updates.at(-1)?.[0].elapsedMs, 300); assert.equal(updates.at(-1)?.[0].state, 'completed')
  assert(updates.at(-1)?.slice(1).every(group => group.queueMs === 900))
  for (let index = 1; index < 4; index++) mock.calls[index].begin()
  advance(100)
  assert(updates.at(-1)?.slice(1).every(group => group.elapsedMs === 100 && group.queueMs === 900))
  for (let index = 1; index < 4; index++) mock.finish(index, 'complete')
  await pending
  const count = updates.length; advance(500)
  assert.equal(updates.length, count, 'completed batches release their interval')
})

test('failed timers stop, retries reset only failed parts, and cancellation releases the retry interval', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const advance = (ms: number) => { now += ms; t.mock.timers.tick(ms) }
  const mock = mockAI(), updates: ImportGroupProgress[][] = [], controller = new AbortController()
  const batch = createImportBatch(mock.ai, 1, choice, (['basics', 'description'] as const).map(id => ({ id, prompt: id, parse: (text: string) => text })))
  t.after(() => controller.abort())
  const pending = batch.run(controller.signal, groups => updates.push(groups))
  advance(200); mock.finish(0, 'saved'); mock.fail(1)
  await assert.rejects(pending, /AI_RATE_LIMITED/)
  const failedCount = updates.length; advance(500)
  assert.equal(updates.length, failedCount)
  const retry = batch.run(controller.signal, groups => updates.push(groups))
  assert.equal(updates.at(-1)?.[1].elapsedMs, 0)
  advance(300)
  assert.equal(updates.at(-1)?.[0].elapsedMs, 200); assert.equal(updates.at(-1)?.[1].elapsedMs, 300)
  controller.abort(); await assert.rejects(retry)
  const cancelledCount = updates.length; advance(500)
  assert.equal(updates.length, cancelledCount, 'cancelled batches release their interval')
})
