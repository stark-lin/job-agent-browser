import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture, seed, value } from './helpers'
import { trustedDataSender } from '../src/platform/electron/main/data-ipc'
import { methodNames } from '../src/platform/electron/data-contract'

test('public bridge exposes business capabilities only, with no SQL, audit write or generator steps', (t) => {
  const f = fixture(t)
  assert.deepEqual(Object.keys(f.api.audit), ['list'])
  for (const [group, methods] of Object.entries(methodNames)) assert.deepEqual(Object.keys(f.api[group as keyof typeof f.api]), [...methods])
  for (const [group, method] of [['audit', 'append'], ['jobs', 'executeSQL'], ['resumes', 'publishArtifact'], ['generation', 'start'], ['__proto__', 'toString'], ['jobs', 'constructor']]) {
    assert.deepEqual(f.backend.dispatch(group, method, {}), { ok: false, error: 'INVALID_INPUT' })
  }
})

test('privileged IPC requires the exact trusted document, top frame and owned window', () => {
  const good = { windowOwned: true, mainFrame: true, url: 'file:///app/index.html' }
  assert.equal(trustedDataSender(good, good.url), true)
  assert.equal(trustedDataSender({ ...good, url: `${good.url}#route` }, good.url), true)
  assert.equal(trustedDataSender({ ...good, mainFrame: false }, good.url), false)
  assert.equal(trustedDataSender({ ...good, windowOwned: false }, good.url), false)
  assert.equal(trustedDataSender({ ...good, url: 'https://example.com' }, good.url), false)
  assert.equal(trustedDataSender({ ...good, url: `${good.url}?untrusted=1` }, good.url), false)
  assert.equal(trustedDataSender({ ...good, url: 'file:///other/index.html' }, good.url), false)
})

test('query pagination is bounded and deterministic, while unknown fields are rejected', async (t) => {
  const f = fixture(t)
  for (let i = 0; i < 3; i++) value(await f.api.jobs.saveJob({ details: { title: `Job ${i}`, companyNameRaw: 'Company' } }))
  const first = value(await f.api.jobs.listJobs({ limit: 1, offset: 0 })), next = value(await f.api.jobs.listJobs({ limit: 1, offset: 1 }))
  assert.equal(first.total, 3)
  assert.equal(first.items.length, 1)
  assert.notEqual(first.items[0].id, next.items[0].id)
  assert.deepEqual(value(await f.api.jobs.listJobs({ limit: 1, offset: 0 })), first)
  assert.deepEqual(await f.api.jobs.listJobs({ limit: 101 }), { ok: false, error: 'INVALID_INPUT' })
  assert.deepEqual(f.backend.dispatch('jobs', 'listJobs', { where: '1=1' }), { ok: false, error: 'INVALID_INPUT' })
})

test('settings and secrets remain explicit scaffolds and do not log credentials', async (t) => {
  const f = fixture(t)
  assert.deepEqual(await f.api.settings.get({}), { ok: false, error: 'NOT_IMPLEMENTED' })
  assert.deepEqual(await f.api.secrets.saveProviderKey({ provider: 'openai', apiKey: 'PRIVATE_API_KEY' }), { ok: false, error: 'NOT_IMPLEMENTED' })
  assert.equal(value(await f.api.audit.list({})).total, 0)
})

test('deleted IDs cannot be resurrected, failed deletes do not create deleted markers', async (t) => {
  const f = await seed(t), id = f.job.id
  value(await f.api.jobs.deleteJob({ id }))
  assert.throws(() => f.database.transactions.forActor('USER').write({ event: 'JOB_SAVE', action: 'CREATE', target: 'job' }, () => {
    f.database.connection.prepare(`INSERT INTO jobs(id,company_name_raw,title,description,location_text,locations_json,employment_type,requirements_json,application_status,saved_at,notes,created_at,updated_at)
      VALUES(?,?,?,'','','[]','','[]','NOT_STARTED',?,'',?,?)`).run(id, 'Company', 'Revived', new Date().toISOString(), new Date().toISOString(), new Date().toISOString())
  }), { code: 'CONFLICT' })
  assert.deepEqual(await f.api.jobs.deleteJob({ id: randomUUID() }), { ok: false, error: 'NOT_FOUND' })
  assert.equal(value(await f.api.audit.list({ targetId: id })).items.filter((e) => e.action === 'DELETE' && e.status === 'SUCCESS').length, 1)
})
