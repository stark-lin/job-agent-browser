import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import { firstPartyFixture } from './first-party-fixture'
import { fixture, value } from './helpers'
import { migrate, migrations } from '../src/platform/database/migrations'
import { Transactions } from '../src/platform/database/transactions'
import type { Profile, ProfileItem, Fact } from '../src/domain/candidate/candidate.types'
import type { PageResult } from '../src/domain/common/ports'

type Versioned<T> = T & { revision: number }
const signal = () => new AbortController().signal

test('profile MCP creates and patches without clearing omitted fields, preserves metadata and fact ownership, and replays original receipts', async t => {
  const f = await firstPartyFixture(t), tools = await f.mcp.session('ask-ai', signal())
  const call = <T>(name: string, args: object) => tools.call(name, args, signal()) as Promise<T>
  const request = { requestId: randomUUID(), details: { name: 'Resume Person', email: 'keep@example.com', introduction: 'Original introduction', links: [{ label: 'Portfolio', url: 'https://example.com' }] } }
  const profile = await call<Profile>('profile.create', request)
  assert.equal(profile.revision, 1)
  assert.deepEqual(await call('profile.create', request), profile)
  let current = await call<Profile>('profile.update', { id: profile.id, requestId: randomUUID(), expectedRevision: profile.revision, changes: { phone: '123' } })
  assert.equal(current.email, profile.email); assert.equal(current.introduction, profile.introduction); assert.deepEqual(current.links, profile.links)
  assert.equal(current.revision, profile.revision + 1)
  assert.deepEqual(await call('profile.create', request), profile, 'replay must not overwrite the live profile')
  const beforeNoop = current.revision
  current = await call('profile.update', { id: profile.id, requestId: randomUUID(), expectedRevision: current.revision, changes: { phone: '123' } })
  assert.equal(current.revision, beforeNoop)
  const add = { profileId: profile.id, requestId: randomUUID(), expectedRevision: current.revision,
    details: { type: 'PROJECT', title: 'Source project', summary: 'Repository inspected', metadata: { url: 'https://example.com/repo', technologies: ['TypeScript'], startDateText: '2025' } } }
  const item = await call<Versioned<ProfileItem>>('profile.add_item', add)
  const edited = await call<Versioned<ProfileItem>>('profile.update_item', { id: item.id, profileId: profile.id, requestId: randomUUID(), expectedRevision: item.revision, changes: { metadata: { technologies: ['TypeScript', 'SQLite'] } } })
  assert.equal(edited.metadata.url, item.metadata.url); assert.equal(edited.metadata.startDateText, '2025'); assert.equal(edited.summary, item.summary)
  assert.deepEqual(edited.metadata.technologies, ['TypeScript', 'SQLite'])
  assert.deepEqual(await call('profile.add_item', add), item)
  const added = await call<Versioned<Fact>>('profile.add_fact', { profileId: profile.id, profileItemId: item.id, requestId: randomUUID(), expectedRevision: edited.revision,
    details: { kind: 'OTHER', content: 'The project validates ownership', tags: ['SQLite'], evidence: 'repo@abc123 src/ownership.ts:12; inspected implementation; no authorship claim' } })
  const fact = await call<Versioned<Fact>>('profile.update_fact', { id: added.id, profileId: profile.id, requestId: randomUUID(), expectedRevision: added.revision, changes: { tags: ['SQLite', 'validation'] } })
  assert.equal(fact.profileItemId, item.id); assert.equal(fact.content, added.content); assert.equal(fact.evidence, added.evidence)
  const detached = await call<Versioned<Fact>>('profile.update_fact', { id: fact.id, profileId: profile.id, requestId: randomUUID(), expectedRevision: fact.revision, changes: { profileItemId: null } })
  assert.equal(detached.profileItemId, null)
  current = await call('profile.update', { id: profile.id, requestId: randomUUID(), expectedRevision: detached.revision, changes: { phone: '', links: [] } })
  assert.equal(current.phone, ''); assert.deepEqual(current.links, []); assert.equal(current.email, profile.email)
  const page = await call<PageResult<ProfileItem>>('profile.list_items', { profileId: profile.id, limit: 1, offset: 0 })
  assert.equal(page.total, 1); assert.equal(page.items[0].id, item.id)
  assert.equal((await call<PageResult<ProfileItem>>('profile.list_items', { profileId: profile.id, offset: 1 })).items.length, 0)
  await assert.rejects(call('profile.create', { ...request, details: { ...request.details, name: 'Changed payload' } }), { code: 'TOOL_CONFLICT' })
  const audit = value(await f.api.audit.list({ targetType: 'fact', targetId: fact.id, limit: 100 }))
  assert(audit.items.some(entry => entry.actorId === 'mcp-client' && entry.source === 'MCP_SERVER'))
  assert(!JSON.stringify(f.backend.toolAudit.list()).includes('keep@example.com'))
})

test('concurrent profile writes reject stale revisions; identical retries survive independent sessions and restart', async t => {
  const f = await firstPartyFixture(t)
  const [a, b] = await Promise.all([f.mcp.session('ask-ai', signal()), f.mcp.session('application', signal())])
  const current = await a.call('profile.get', { id: f.profile.id }, signal()) as Profile
  const request = { profileId: current.id, expectedRevision: current.revision, requestId: randomUUID(), details: { type: 'PROJECT', title: 'One project' } }
  const [left, right] = await Promise.all([a.call('profile.add_item', request, signal()), b.call('profile.add_item', request, signal())])
  assert.deepEqual(left, right)
  const revision = (left as Versioned<ProfileItem>).revision
  const patch = { id: current.id, expectedRevision: revision, changes: { location: 'Sydney' } }
  const results = await Promise.allSettled([a.call('profile.update', { ...patch, requestId: randomUUID() }, signal()), b.call('profile.update', { ...patch, requestId: randomUUID() }, signal())])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult
  assert.equal(rejected.reason.code, 'TOOL_CONFLICT')
  await a.close()
  const restarted = await f.mcp.session('ask-ai', signal())
  assert.deepEqual(await restarted.call('profile.add_item', request, signal()), left)
  assert.equal(value(await f.api.profiles.listItems({ profileId: current.id })).total, 2)
  value(await f.api.profiles.deleteItem({ id: (left as ProfileItem).id }))
  await assert.rejects(restarted.call('profile.add_item', request, signal()), { code: 'TOOL_CONFLICT' })
})

test('UI contact, item, fact, import and delete mutations advance the aggregate revision while no-op content stays stable', async t => {
  const f = fixture(t), profile = value(await f.api.profiles.createProfile({ name: 'Person' }))
  const revision = async () => value(await f.api.profiles.getProfile({ id: profile.id })).revision
  let previous = await revision()
  const advanced = async () => { const next = await revision(); assert(next > previous); previous = next }
  value(await f.api.profiles.editContact({ id: profile.id, details: { name: 'Person', phone: '123' } })); await advanced()
  value(await f.api.profiles.editContact({ id: profile.id, details: { name: 'Person', phone: '123' } })); assert.equal(await revision(), previous)
  const item = value(await f.api.profiles.addItem({ profileId: profile.id, details: { type: 'PROJECT', title: 'A' } })); await advanced()
  value(await f.api.profiles.editItem({ id: item.id, details: { type: 'PROJECT', title: 'B' } })); await advanced()
  value(await f.api.profiles.moveItem({ id: item.id, parentItemId: null, sortOrder: 5 })); await advanced()
  const fact = value(await f.api.profiles.addFact({ profileId: profile.id, profileItemId: item.id, details: { kind: 'OTHER', content: 'Original' } })); await advanced()
  value(await f.api.profiles.editFact({ id: fact.id, profileItemId: item.id, details: { kind: 'OTHER', content: 'Updated' } })); await advanced()
  value(await f.api.profiles.deleteFact({ id: fact.id })); await advanced()
  const imported = value(await f.api.profiles.applyImport({ sessionId: randomUUID(), batchId: randomUUID(), profileId: profile.id, contact: { location: 'Sydney' }, links: [],
    items: [{ draftId: randomUUID(), details: { type: 'PROJECT', title: 'Imported' } }], facts: [] })); await advanced()
  assert.equal(imported.profile.revision, previous)
  value(await f.api.profiles.deleteItem({ id: item.id })); await advanced()
})

test('profile tools reject invalid patches, ownership changes, cycles and impossible dates without partial mutation', async t => {
  const f = await firstPartyFixture(t), tools = await f.mcp.session('ask-ai', signal())
  const call = (name: string, args: object) => tools.call(name, args, signal())
  const current = await call('profile.get', { id: f.profile.id }) as Profile
  const base = { profileId: current.id, expectedRevision: current.revision, requestId: randomUUID() }
  const foreignProfile = value(await f.api.profiles.createProfile({ name: 'Other' }))
  const foreignItem = value(await f.api.profiles.addItem({ profileId: foreignProfile.id, details: { type: 'PROJECT', title: 'Other' } }))
  for (const changes of [{}, { name: '' }, { email: null }, { unknown: 'field' }, { revision: 100 }]) {
    await assert.rejects(call('profile.update', { id: current.id, expectedRevision: current.revision, requestId: randomUUID(), changes }), { code: 'TOOL_INVALID_INPUT' })
  }
  await assert.rejects(call('profile.add_item', { ...base, details: { type: 'PROJECT', title: 'Bad dates', startDate: '2026-05-01', endDate: '2025-01-01' } }), { code: 'TOOL_INVALID_INPUT' })
  await assert.rejects(call('profile.add_item', { ...base, parentItemId: foreignItem.id, details: { type: 'PROJECT', title: 'Foreign parent' } }), { code: 'TOOL_CONFLICT' })
  await assert.rejects(call('profile.add_fact', { ...base, profileItemId: foreignItem.id, details: { kind: 'OTHER', content: 'Wrong parent' } }), { code: 'TOOL_FORBIDDEN' })
  await assert.rejects(call('profile.update_item', { ...base, id: foreignItem.id, changes: { title: 'Overwrite' } }), { code: 'TOOL_FORBIDDEN' })
  await assert.rejects(call('profile.update_item', { ...base, id: f.item.id, changes: { type: 'EDUCATION' } }), { code: 'TOOL_INVALID_INPUT' })
  await assert.rejects(call('profile.update_item', { ...base, id: f.item.id, changes: { parentItemId: f.item.id } }), { code: 'TOOL_CONFLICT' })
  await assert.rejects(call('profile.update_item', { ...base, id: f.item.id, changes: { metadata: { inventedField: true } } }), { code: 'TOOL_INVALID_INPUT' })
  assert.equal((await call('profile.get', { id: current.id }) as Profile).revision, current.revision)
  assert.equal(value(await f.api.profiles.listItems({ profileId: current.id })).total, 1)
  assert.equal(f.database.connection.prepare('SELECT count(*) n FROM operation_receipts').get()?.n, 0)
})

test('profile receipts and revisions roll back together, and terminal audit failures can be retried safely', async t => {
  const f = await firstPartyFixture(t), tools = await f.mcp.session('ask-ai', signal())
  const profile = await tools.call('profile.get', { id: f.profile.id }, signal()) as Profile
  const request = { profileId: profile.id, expectedRevision: profile.revision, requestId: randomUUID(), details: { kind: 'OTHER', content: 'Atomic sourced fact', evidence: 'resume.pdf page 1: source excerpt' } }
  f.database.connection.exec("CREATE TRIGGER fixture_receipt_failure BEFORE INSERT ON operation_receipts BEGIN SELECT RAISE(ABORT,'fixture'); END")
  await assert.rejects(tools.call('profile.add_fact', request, signal()), { code: 'TOOL_CONFLICT' })
  assert.equal(value(await f.api.profiles.listFacts({ profileId: profile.id })).total, 1)
  assert.equal(value(await f.api.profiles.getProfile({ id: profile.id })).revision, profile.revision)
  f.database.connection.exec('DROP TRIGGER fixture_receipt_failure')
  f.flag('fail-audit-finish')
  await assert.rejects(tools.call('profile.add_fact', request, signal()), { code: 'TOOL_AUDIT_UNAVAILABLE' })
  assert.equal(value(await f.api.profiles.listFacts({ profileId: profile.id })).total, 2)
  f.flag('fail-audit-finish', false)
  const saved = await tools.call('profile.add_fact', request, signal()) as Versioned<Fact>
  assert.equal(saved.content, request.details.content)
  assert.equal(value(await f.api.profiles.getProfile({ id: profile.id })).revision, saved.revision)
  assert.equal(value(await f.api.profiles.listFacts({ profileId: profile.id })).total, 2)
})

test('MCP edits affect future resume snapshots while prior snapshots remain immutable', async t => {
  const f = await firstPartyFixture(t), tools = await f.mcp.session('ask-ai', signal())
  const first = await tools.call('resume.start', { jobId: f.job.id, profileId: f.profile.id, requestId: randomUUID() }, signal()) as { runId: string }
  const profile = await tools.call('profile.get', { id: f.profile.id }, signal()) as Profile
  const updated = await tools.call('profile.update', { id: profile.id, expectedRevision: profile.revision, requestId: randomUUID(), changes: { name: 'Updated name' } }, signal()) as Profile
  await tools.call('profile.update_fact', { id: f.fact.id, profileId: profile.id, expectedRevision: updated.revision, requestId: randomUUID(), changes: { content: 'Updated source claim' } }, signal())
  const second = await tools.call('resume.start', { jobId: f.job.id, profileId: profile.id, requestId: randomUUID() }, signal()) as { runId: string }
  const oldContext = await tools.call('resume.get_context', { runId: first.runId }, signal()) as { profile: Profile }
  const newContext = await tools.call('resume.get_context', { runId: second.runId }, signal()) as { profile: Profile }
  assert.equal(oldContext.profile.name, f.profile.name); assert.equal(newContext.profile.name, 'Updated name')
  const oldFacts = await tools.call('resume.list_facts', { runId: first.runId }, signal()) as PageResult<Fact>
  const newFacts = await tools.call('resume.list_facts', { runId: second.runId }, signal()) as PageResult<Fact>
  assert.equal(oldFacts.items[0].content, f.fact.content); assert.equal(newFacts.items[0].content, 'Updated source claim')
})

test('migration preserves existing profile data and old receipts and initializes revision without rewriting history', () => {
  const db = new DatabaseSync(':memory:')
  try {
    const tx = new Transactions(db)
    migrate(db, migrations.slice(0, 7))
    const id = randomUUID(), requestId = randomUUID()
    tx.forActor('USER').write({ event: 'PROFILE_CREATE', action: 'CREATE', target: 'profile' }, () => {
      db.prepare('INSERT INTO profiles(id,name,email,phone,location,links_json,updated_at,introduction) VALUES(?,?,?,?,?,?,?,?)').run(id, 'Old profile', 'old@example.com', '', '', '[]', '2026-01-01T00:00:00.000Z', 'Keep introduction')
    })
    db.prepare('INSERT INTO operation_receipts VALUES(?,?,?,?,?,?,?)').run('job.import', requestId, 'hash', 'job', randomUUID(), '{"id":"old"}', '2026-01-01T00:00:00.000Z')
    const audits = db.prepare('SELECT count(*) n FROM audit_logs').get()?.n
    migrate(db)
    const profile = db.prepare('SELECT * FROM profiles WHERE id=?').get(id)
    assert.equal(profile?.revision, 1); assert.equal(profile?.introduction, 'Keep introduction'); assert.equal(profile?.email, 'old@example.com')
    assert.equal(db.prepare('SELECT result_json FROM operation_receipts WHERE request_id=?').get(requestId)?.result_json, '{"id":"old"}')
    assert.equal(db.prepare('SELECT count(*) n FROM audit_logs').get()?.n, audits)
    migrate(db)
  } finally { db.close() }
})

test('partial updates preserve incomplete imported fields and no-op fact/item edits leave revision unchanged', async t => {
  const f = await firstPartyFixture(t), tools = await f.mcp.session('ask-ai', signal())
  const imported = value(await f.api.profiles.applyImport({ sessionId: randomUUID(), batchId: randomUUID(), profileId: null,
    contact: {}, links: [{ draftId: randomUUID(), label: '', url: '' }],
    items: [{ draftId: randomUUID(), details: { type: 'PROJECT', title: '' } }],
    facts: [{ draftId: randomUUID(), itemDraftId: null, profileItemId: null, details: { kind: 'OTHER', content: '' } }] }))
  const patch = { id: imported.profile.id, requestId: randomUUID(), expectedRevision: imported.profile.revision, changes: { phone: '123' } }
  const profile = await tools.call('profile.update', patch, signal()) as Profile
  assert.equal(profile.name, ''); assert.deepEqual(profile.links, [{ label: '', url: '' }])
  const itemRequest = { id: imported.items[0].id, profileId: profile.id, requestId: randomUUID(), expectedRevision: profile.revision, changes: { metadata: { url: 'https://example.com/repo' } } }
  const item = await tools.call('profile.update_item', itemRequest, signal()) as Versioned<ProfileItem>
  assert.equal(item.title, '')
  const noop = await tools.call('profile.update_item', { ...itemRequest, expectedRevision: item.revision, requestId: randomUUID() }, signal()) as Versioned<ProfileItem>
  assert.equal(noop.revision, item.revision)
  const factRequest = { id: imported.facts[0].id, profileId: profile.id, requestId: randomUUID(), expectedRevision: item.revision, changes: { evidence: 'Original resume, page 1' } }
  const fact = await tools.call('profile.update_fact', factRequest, signal()) as Versioned<Fact>
  assert.equal(fact.content, '')
  const factNoop = await tools.call('profile.update_fact', { ...factRequest, expectedRevision: fact.revision, requestId: randomUUID() }, signal()) as Versioned<Fact>
  assert.equal(factNoop.revision, fact.revision)
  assert.deepEqual(await tools.call('profile.update', patch, signal()), profile)
  assert.deepEqual(await tools.call('profile.update_item', itemRequest, signal()), item)
  assert.deepEqual(await tools.call('profile.update_fact', factRequest, signal()), fact)
})

test('Ask AI discovers profile writes, carries revisions and presents safe summaries through real MCP', async t => {
  const f = await firstPartyFixture(t)
  let revision = 0, profileId = '', itemId = '', step = 0
  const plan: (() => [string, object])[] = [
    () => ['profile.create', { requestId: randomUUID(), details: { name: 'PRIVATE_DISTILLED_PERSON' } }],
    () => ['profile.list_items', { profileId }],
    () => ['profile.add_item', { profileId, expectedRevision: revision, requestId: randomUUID(), details: { type: 'PROJECT', title: 'PRIVATE_REPO_TITLE' } }],
    () => ['profile.add_fact', { profileId, profileItemId: itemId, expectedRevision: revision, requestId: randomUUID(), details: { kind: 'OTHER', content: 'PRIVATE_IMPLEMENTATION_CLAIM', evidence: 'PRIVATE_SOURCE_LOCATOR' } }],
    () => ['profile.update', { id: profileId, expectedRevision: revision, requestId: randomUUID(), changes: { phone: '123' } }]
  ]
  const model: import('../src/shared/agent').StreamingAgentModel = {
    complete: async () => ({ content: '', toolCalls: [] }), async *stream(input) {
      assert(input.tools.some(tool => tool.name === 'profile.create'))
      assert(input.tools.some(tool => tool.name === 'profile.list_items'))
      const previous = input.messages.at(-1)
      if (previous?.role === 'tool') {
        const result = JSON.parse(previous.content)
        assert.equal(result.error ?? null, null)
        if (result.revision) revision = result.revision
        if (step === 1) profileId = result.id
        if (step === 3) itemId = result.id
      }
      if (step === plan.length) { yield { type: 'content.delta', text: 'Saved' }; yield { type: 'completed', response: { content: 'Saved', toolCalls: [] } }; return }
      const [name, args] = plan[step++](), call = { id: `step-${step}`, name, arguments: args }
      yield { type: 'tool_call.ready', call }
      yield { type: 'completed', response: { content: '', toolCalls: [call] } }
    }
  }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const ids = tasks.start(1, { requestId: randomUUID(), message: 'Import the supplied resume and project evidence into a new profile', choice: { providerId: 'fixture', modelId: 'test' } }, () => {})
  for (let n = 0; n < 500 && tasks.getRun(1, { runId: ids.runId }).run.state === 'running'; n++) await new Promise(resolve => setTimeout(resolve, 10))
  const snapshot = tasks.getRun(1, { runId: ids.runId })
  assert.equal(snapshot.run.state, 'completed', snapshot.run.error ?? '')
  assert(snapshot.run.writeStarted)
  for (const item of snapshot.items) if (item.content.type === 'tool_call') assert.notEqual(item.content.display.key, 'tool')
  for (const privateText of ['PRIVATE_DISTILLED_PERSON', 'PRIVATE_REPO_TITLE', 'PRIVATE_IMPLEMENTATION_CLAIM', 'PRIVATE_SOURCE_LOCATOR']) assert(!JSON.stringify(snapshot).includes(privateText))
  const facts = value(await f.api.profiles.listFacts({ profileId }))
  assert.equal(facts.total, 1); assert.equal(facts.items[0].evidence, 'PRIVATE_SOURCE_LOCATOR'); assert.equal(facts.items[0].profileItemId, itemId)
})
