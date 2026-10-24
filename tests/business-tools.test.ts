import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { firstPartyFixture } from './first-party-fixture'
import type { Job } from '../src/domain/job/job.types'
import type { JobEvent } from '../src/domain/application/application.types'
import type { PageResult } from '../src/domain/common/ports'
import { applicationState } from '../src/domain/application/workflow'

const signal = () => new AbortController().signal

test('job import validates structured data, atomically records sources and receipts, and retries without replacing live data', async t => {
  const f = await firstPartyFixture(t), tools = await f.mcp.session('job-capture', signal())
  const request = { requestId: randomUUID(), details: { title: 'Engineer', companyNameRaw: 'Company', description: 'Original' },
    source: { url: 'https://example.com/job?b=2&a=1#section', cleanedContent: 'Source' } }
  const saved = await tools.call('job.import', request, signal()) as Job
  assert.deepEqual(await tools.call('job.import', request, signal()), saved)
  const sources = f.backend.dispatch('jobs', 'listSources', { jobId: saved.id })
  assert(sources.ok); assert.equal((sources.value as PageResult<{ normalizedUrl: string }>).items[0].normalizedUrl, 'https://example.com/job?a=1&b=2')
  await tools.call('job.update', { id: saved.id, changes: { description: 'Edited' } }, signal())
  assert.deepEqual(await tools.call('job.import', request, signal()), saved)
  assert.equal(f.backend.jobs.getJob({ id: saved.id }).description, 'Edited')
  await assert.rejects(tools.call('job.import', { ...request, details: { ...request.details, title: 'Other' } }, signal()), { code: 'TOOL_CONFLICT' })
  for (const invalid of [
    { details: { title: 'X', companyNameRaw: 'Y', salary: { min: 10, max: 1, currency: 'AUD', text: '', period: 'YEAR' } } },
    { details: request.details, source: { url: 'file:///private/file' } },
    { details: { title: '', companyNameRaw: 'Y' } }
  ]) await assert.rejects(tools.call('job.import', { ...invalid, requestId: randomUUID() }, signal()), { code: 'TOOL_INVALID_INPUT' })
  assert.equal(f.database.connection.prepare('SELECT count(*) n FROM operation_receipts').get()?.n, 1)
  assert.equal(f.backend.jobs.listJobs({}).total, 2)
  f.backend.jobs.deleteJob({ id: saved.id })
  await assert.rejects(tools.call('job.import', request, signal()), { code: 'TOOL_CONFLICT' })
})

test('application tools enforce transitions, archive rules, event ownership and idempotent mutations', async t => {
  const f = await firstPartyFixture(t), tools = await f.mcp.session('application', signal()), jobId = f.job.id
  const call = (name: string, args: object) => tools.call(name, args, signal())
  const before = await call('application.get', { jobId }) as ReturnType<typeof applicationState>
  assert(before.allowedNextStatuses.includes('APPLIED'))
  await assert.rejects(call('application.set_status', { jobId, status: 'ACCEPTED' }), { code: 'TOOL_CONFLICT' })
  const applied = await call('application.set_status', { jobId, status: 'APPLIED' })
  assert.deepEqual(await call('application.set_status', { jobId, status: 'APPLIED' }), applied)
  assert.equal((await call('application.list_events', { jobId }) as PageResult<JobEvent>).total, 1)
  const patch = { id: jobId, changes: { notes: 'Reviewed' } }
  const edited = await call('job.update', patch) as Job
  assert.equal(edited.description, f.job.description)
  assert.deepEqual(await call('job.update', patch), edited)
  await assert.rejects(call('job.update', { id: jobId, changes: { applicationStatus: 'OFFER' } }), { code: 'TOOL_INVALID_INPUT' })
  const archived = await call('job.set_archived', { id: jobId, archived: true })
  assert.deepEqual(await call('job.set_archived', { id: jobId, archived: true }), archived)
  assert.deepEqual((await call('application.get', { jobId }) as ReturnType<typeof applicationState>).allowedNextStatuses, [])
  await assert.rejects(call('application.set_status', { jobId, status: 'INTERVIEW' }), { code: 'TOOL_CONFLICT' })
  const note = { jobId, text: 'Still keep a note', requestId: randomUUID() }
  const event = await call('application.add_note', note)
  assert.deepEqual(await call('application.add_note', note), event)
  await assert.rejects(call('application.add_note', { ...note, text: 'Conflict' }), { code: 'TOOL_CONFLICT' })
  const schedule = { jobId, requestId: randomUUID(), type: 'INTERVIEW', title: 'Interview', startsAt: '2026-10-27T03:00:00.000Z' }
  await assert.rejects(call('application.schedule_event', schedule), { code: 'TOOL_CONFLICT' })
  await call('job.set_archived', { id: jobId, archived: false })
  const scheduled = await call('application.schedule_event', schedule) as JobEvent
  assert.deepEqual(await call('application.schedule_event', schedule), scheduled)
  const other = f.backend.jobs.saveJob({ details: { title: 'Other', companyNameRaw: 'Other' } })
  const reschedule = { id: scheduled.id, jobId, startsAt: '2026-10-28T03:00:00.000Z' }
  await assert.rejects(call('application.reschedule_event', { ...reschedule, jobId: other.id }), { code: 'TOOL_FORBIDDEN' })
  const moved = await call('application.reschedule_event', reschedule)
  assert.deepEqual(await call('application.reschedule_event', reschedule), moved)
  assert.equal((await call('application.list_events', { jobId }) as PageResult<JobEvent>).total, 3)
  const events = f.backend.dispatch('audit', 'list', { targetType: 'job_event', targetId: scheduled.id })
  assert(events.ok)
  assert.equal((events.value as PageResult<{ eventType: string; status: string }>).items.filter(item => item.eventType === 'APPLICATION_RESCHEDULE' && item.status === 'SUCCESS').length, 1)
})

test('operation receipts survive concurrent independent Server writes and a Server restart', async t => {
  const f = await firstPartyFixture(t)
  const [a, b] = await Promise.all([f.mcp.session('job-capture', signal()), f.mcp.session('application', signal())])
  const request = { requestId: randomUUID(), details: { title: 'Concurrent', companyNameRaw: 'Company' } }
  const [left, right] = await Promise.all([a.call('job.import', request, signal()), b.call('job.import', request, signal())])
  assert.deepEqual(left, right)
  const note = { requestId: randomUUID(), jobId: f.job.id, text: 'One note' }
  const [one, two] = await Promise.all([a.call('application.add_note', note, signal()), b.call('application.add_note', note, signal())])
  assert.deepEqual(one, two)
  await a.close()
  const restarted = await f.mcp.session('job-capture', signal())
  assert.deepEqual(await restarted.call('job.import', request, signal()), left)
  assert.deepEqual(await restarted.call('application.add_note', note, signal()), one)
  assert.equal(f.backend.jobs.listJobs({}).total, 2)
  assert.equal(f.backend.applications.listEvents({ jobId: f.job.id }).total, 1)
})

test('receipt and business changes roll back together, while a lost terminal audit can be retried without duplication', async t => {
  const f = await firstPartyFixture(t), tools = await f.mcp.session('job-capture', signal())
  const request = { requestId: randomUUID(), details: { title: 'Atomic receipt', companyNameRaw: 'Company' } }
  f.database.connection.exec("CREATE TRIGGER fixture_receipt_failure BEFORE INSERT ON operation_receipts BEGIN SELECT RAISE(ABORT,'fixture'); END")
  await assert.rejects(tools.call('job.import', request, signal()), { code: 'TOOL_CONFLICT' })
  assert.equal(f.backend.jobs.listJobs({}).total, 1)
  assert.equal(f.database.connection.prepare('SELECT count(*) n FROM operation_receipts').get()?.n, 0)
  f.database.connection.exec('DROP TRIGGER fixture_receipt_failure')
  f.flag('fail-audit-finish')
  await assert.rejects(tools.call('job.import', request, signal()), { code: 'TOOL_AUDIT_UNAVAILABLE' })
  assert.equal(f.backend.jobs.listJobs({}).total, 2)
  assert.equal(f.database.connection.prepare('SELECT count(*) n FROM operation_receipts').get()?.n, 1)
  f.flag('fail-audit-finish', false)
  const saved = await tools.call('job.import', request, signal()) as Job
  assert.equal(saved.title, request.details.title)
  assert.equal(f.backend.jobs.listJobs({}).total, 2)
  assert(!JSON.stringify(f.backend.toolAudit.list()).includes('Atomic receipt'))
})

test('cancelling one pending first-party connection waiter preserves the shared session for another owner', async t => {
  const f = await firstPartyFixture(t), cancelled = new AbortController()
  const first = f.mcp.session('application', cancelled.signal), second = f.mcp.session('application', signal())
  cancelled.abort()
  await assert.rejects(first, { code: 'AGENT_CANCELLED' })
  const tools = await second
  const job = await tools.call('job.get', { id: f.job.id }, signal()) as Job
  assert.equal(job.id, f.job.id)
})
