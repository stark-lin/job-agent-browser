import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyAuditDraft, parseAuditDraft } from '../src/pages/settings/audit-filters'
import { fixture, value } from './helpers'

test('viewer filters omit blank fields, trim exact IDs and use the existing audit endpoint', async t => {
  const f = fixture(t)
  const job = value(await f.api.jobs.saveJob({ details: { title: 'Private role', companyNameRaw: 'Private company' } }))
  const entry = value(await f.api.audit.list({})).items[0]
  assert.deepEqual(parseAuditDraft(emptyAuditDraft), { ok: true, filter: {} })
  const parsed = parseAuditDraft({ ...emptyAuditDraft, targetType: 'job', status: 'SUCCESS', targetId: ` ${job.id} `,
    requestId: ` ${entry.requestId} `, transactionId: entry.transactionId })
  assert(parsed.ok)
  const result = value(await f.api.audit.list({ ...parsed.filter, limit: 25, offset: 0 }))
  assert.equal(result.total, 1)
  assert.equal(result.items[0].id, entry.id)
  assert.equal(value(await f.api.audit.list({})).total, 1, 'Viewing does not write audit')
})

test('viewer rejects invalid IDs, calendar dates and reversed ranges before IPC', () => {
  for (const [field, invalid] of [['requestId', 'not-a-uuid'], ['transactionId', 'not-a-uuid'], ['targetId', 'x'.repeat(121)],
    ['targetId', 'a\0b'], ['from', '2026-02-30T12:00'], ['to', 'not-a-date']] as const) {
    assert.deepEqual(parseAuditDraft({ ...emptyAuditDraft, [field]: invalid }), { ok: false, field })
  }
  assert.deepEqual(parseAuditDraft({ ...emptyAuditDraft, from: '2026-10-14T12:00', to: '2026-10-13T12:00' }), { ok: false, field: 'range' })
})

test('viewer local times convert to canonical UTC with inclusive bounds, including DST', async t => {
  const original = process.env.TZ
  process.env.TZ = 'Australia/Sydney'
  t.after(() => { if (original === undefined) delete process.env.TZ; else process.env.TZ = original })
  const parsed = parseAuditDraft({ ...emptyAuditDraft, from: '2026-10-14T12:30', to: '2026-10-14T12:30' })
  assert.deepEqual(parsed, { ok: true, filter: { from: '2026-10-14T01:30:00.000Z', to: '2026-10-14T01:30:00.000Z' } })
  assert.deepEqual(parseAuditDraft({ ...emptyAuditDraft, from: '2026-10-04T02:30' }), { ok: false, field: 'from' })
  const f = fixture(t)
  value(await f.api.profiles.createProfile({ name: 'Private person' }))
  const entry = value(await f.api.audit.list({})).items[0]
  assert.equal(value(await f.api.audit.list({ from: entry.timestamp, to: entry.timestamp })).total, 1)
})

test('audit pagination orders by sequence and combined filters preserve matching totals', async t => {
  const f = fixture(t)
  for (let index = 0; index < 27; index++) value(await f.api.profiles.createProfile({ name: `Private ${index}` }))
  assert.equal((await f.api.profiles.createProfile({ name: '' })).ok, false)
  const first = value(await f.api.audit.list({ targetType: 'profile', status: 'SUCCESS', limit: 25 }))
  const second = value(await f.api.audit.list({ targetType: 'profile', status: 'SUCCESS', limit: 25, offset: 25 }))
  assert.equal(first.total, 27); assert.equal(second.total, 27)
  assert.equal(first.items.length, 25); assert.equal(second.items.length, 2)
  assert(first.items.at(-1)!.sequence > second.items[0].sequence)
  assert.equal(new Set([...first.items, ...second.items].map(entry => entry.id)).size, 27)
  assert.equal(value(await f.api.audit.list({ targetType: 'profile', status: 'FAILURE' })).total, 1)
})
