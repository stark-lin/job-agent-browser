import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { snapshotFromHTML } from '../src/platform/job-import/html'
import { createURLReader } from '../src/platform/job-import/url-reader'
import { createJobExtractor } from '../src/platform/job-import/extractor'
import { createJobImporter } from '../src/platform/job-import/service'
import type { JobImportEvent } from '../src/platform/electron/job-import-contract'
import type { AIService } from '../src/platform/ai'
import { parseJobDraft } from '../src/domain/job/job.extraction.validation'
import { emptyJob, fillEmptyJob } from '../src/pages/find-jobs/job-form'
import { fixture, value } from './helpers'

const url = 'https://example.com/job', choice = { providerId: 'fixture', modelId: 'fixture' }
const description = 'Build reliable services with TypeScript. Work with our Sydney team to deliver useful products and reliable software.'
const html = `<html><head><title>Engineer &amp; Developer</title><script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"Engineer"}]}</script></head><body><nav>Ignore navigation</nav><main><h1>Engineer</h1><p>${description}</p><script>malicious()</script><div hidden>Secret</div></main></body></html>`
const snapshot = snapshotFromHTML(html, url, url)
function mockAI(output: string): Pick<AIService, 'start' | 'cancel'> {
  return { start(_owner, _input, emit) {
    const requestId = randomUUID()
    setImmediate(() => { emit({ requestId, type: 'delta', text: output }); emit({ requestId, type: 'completed' }) })
    return { requestId }
  }, cancel() {} }
}
test('HTML snapshots decode text, retain JobPosting and exclude scripts, navigation and hidden content', () => {
  assert.equal(snapshot.pageTitle, 'Engineer & Developer')
  assert.match(snapshot.cleanedContent, /Build reliable services/)
  assert(!/malicious|Ignore navigation|Secret/.test(snapshot.cleanedContent))
  assert.deepEqual(snapshot.jobPosting, [{ '@type': 'JobPosting', title: 'Engineer' }])
  assert.throws(() => snapshotFromHTML('<title>Sign in</title><input type="password">', url, 'https://example.com/login'), /JOB_ACCESS_RESTRICTED/)
  assert.throws(() => snapshotFromHTML('<div id="root"></div><script>renderJob()</script>', url, url), /JOB_NO_CONTENT/)
  assert.throws(() => snapshotFromHTML(`<main>${'a'.repeat(60001)}</main>`, url, url), /JOB_CONTENT_TOO_LARGE/)
})
test('URL reader bounds redirects, rejects restricted/non-HTML responses and sends no website credentials', async () => {
  let calls = 0
  const transport: typeof fetch = async (input, init) => {
    calls++; assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'manual')
    assert(!('Cookie' in (init?.headers ?? {})))
    return calls === 1 ? new Response(null, { status: 302, headers: { location: '/final' } })
      : (assert.equal(String(input), 'https://example.com/final'), new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
  }
  const result = await createURLReader(transport).read(url, new AbortController().signal)
  assert.equal(result.requestedUrl, url); assert.equal(result.url, 'https://example.com/final')
  for (const status of [401, 403, 429]) await assert.rejects(createURLReader(async () => new Response(null, { status })).read(url, new AbortController().signal), /JOB_ACCESS_RESTRICTED/)
  await assert.rejects(createURLReader(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })).read(url, new AbortController().signal), /JOB_NO_CONTENT/)
  await assert.rejects(createURLReader(async () => new Response(null, { status: 302, headers: { location: '/again' } })).read(url, new AbortController().signal), /JOB_FETCH_FAILED/)
  await assert.rejects(createURLReader(async () => new Response('a'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/html' } })).read(url, new AbortController().signal), /JOB_CONTENT_TOO_LARGE/)
  await assert.rejects(createURLReader(transport).read('file:///etc/passwd', new AbortController().signal), /INVALID_INPUT/)
})
test('URL timeout and cancellation release the pending transport with distinct fixed errors', async () => {
  const transport: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
  await assert.rejects(createURLReader(transport, 5).read(url, new AbortController().signal), /JOB_FETCH_TIMEOUT/)
  const controller = new AbortController(), pending = createURLReader(transport).read(url, controller.signal)
  controller.abort(); await assert.rejects(pending, /AI_CANCELLED/)
})
test('AI extractor permits incomplete drafts, rejects unknown/managed fields, invalid salaries and non-job output', async () => {
  const signal = new AbortController().signal
  const draft = await createJobExtractor(mockAI('{"title":"Engineer"}'), 1, choice).extract(snapshot, signal)
  assert.equal(draft.companyNameRaw, ''); assert.equal(draft.salary, null)
  for (const output of ['{}', '{"title":"Engineer","id":"injected"}', '{"title":"Engineer","companyId":null}', '{"title":"Engineer","applicationStatus":"APPLIED"}', 'bad JSON', '{"title":"Engineer","salary":{"min":20,"max":10,"currency":"AUD","text":"","period":"YEAR"}}']) {
    await assert.rejects(createJobExtractor(mockAI(output), 1, choice).extract(snapshot, signal), /JOB_INVALID_OUTPUT|JOB_NO_CONTENT/)
  }
})
test('cancelling AI extraction suppresses late provider output', async () => {
  let callback: Parameters<AIService['start']>[2] | undefined, cancelled = false
  const controller = new AbortController()
  const ai: Pick<AIService, 'start' | 'cancel'> = { start(_owner, _input, emit) { callback = emit; return { requestId: randomUUID() } }, cancel() { cancelled = true } }
  const pending = createJobExtractor(ai, 1, choice).extract(snapshot, controller.signal)
  controller.abort(); await assert.rejects(pending, /AI_CANCELLED/); assert(cancelled)
  callback!({ requestId: randomUUID(), type: 'completed' })
})
test('manual data is preserved, including complete salary and collection fields', () => {
  const current = { ...emptyJob(), title: 'Manual title', notes: 'Private notes',
    salary: { min: 1, max: 2, currency: 'AUD', text: '', period: 'YEAR' as const }, requirements: [{ text: 'Manual', type: 'OTHER' as const, keywords: [] }] }
  const draft = parseJobDraft({ title: 'AI title', companyNameRaw: 'Company', description, requirements: [{ text: 'AI', type: 'REQUIRED', keywords: [] }] })
  const filled = fillEmptyJob(current, draft)
  assert.equal(filled.title, current.title); assert.equal(filled.notes, current.notes)
  assert.deepEqual(filled.salary, current.salary); assert.deepEqual(filled.requirements, current.requirements)
  assert.equal(filled.companyNameRaw, 'Company'); assert.equal(filled.description, description)
})
test('import task ownership, cancellation and failures never persist job data; confirmed save is NOT_STARTED', async t => {
  const f = fixture(t), events: JobImportEvent[] = [], ai = mockAI('{"title":"Engineer","companyNameRaw":"Company"}')
  const importer = createJobImporter({ ai, reader: { read: async () => snapshot } })
  t.after(() => importer.dispose())
  const ready = new Promise<JobImportEvent & { type: 'ready' }>(resolve => importer.start(1, { url, choice }, event => { events.push(event); if (event.type === 'ready') resolve(event) }))
  const imported = await ready
  assert.equal(value(await f.api.jobs.listJobs({})).total, 0)
  const job = value(await f.api.jobs.saveJob(imported.draft))
  assert.equal(job.applicationStatus, 'NOT_STARTED'); assert.equal(job.appliedAt, null); assert.equal(job.closedAt, null)
  assert.equal(value(await f.api.applications.listEvents({ jobId: job.id })).total, 0)
  assert.equal(value(await f.api.jobs.listSources({ jobId: job.id })).items[0].url, url)
  assert(value(await f.api.jobs.listSources({ jobId: job.id })).items[0].cleanedContent.includes('"@type":"JobPosting"'))
  let release!: (value: typeof snapshot) => void
  const late = createJobImporter({ ai, reader: { read: () => new Promise(resolve => { release = resolve }) } })
  const received: JobImportEvent[] = [], task = late.start(1, { url, choice }, event => received.push(event))
  await new Promise(resolve => setImmediate(resolve))
  assert.throws(() => late.cancel(2, task), /FORBIDDEN/)
  late.cancel(1, task); release(snapshot)
  await new Promise(resolve => setImmediate(resolve))
  assert(!received.some(event => event.type === 'ready')); assert.equal(received.at(-1)?.type, 'cancelled')
  late.dispose()
  const before = value(await f.api.jobs.listJobs({})).total
  assert.deepEqual(await f.api.jobs.saveJob({ details: { title: 'Bad source', companyNameRaw: 'Company' }, source: { url: 'file:///invalid' } }), { ok: false, error: 'INVALID_INPUT' })
  assert.equal(value(await f.api.jobs.listJobs({})).total, before)
})
