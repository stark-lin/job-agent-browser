import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { migrate, migrations } from '../src/platform/database/migrations'
import { LegacyTransactions as Transactions } from './legacy-migration-fixture'
import { Store } from '../src/platform/database/repositories/store'
import { composeBackend } from '../src/platform/database/backend'
import { seed, value } from './helpers'
import { createJobAgentTooling, jobAgentAllowlist } from '../src/platform/tools'
import type { ToolOutput } from '../src/shared/tools/tool.types'

export const data = <T>(output: ToolOutput) => output.structuredContent as unknown as T
export async function resumeTools(t: Parameters<typeof seed>[0]) {
  const f = await seed(t), tooling = createJobAgentTooling(f.backend, async () => ({ output: { status: 'READY' } }))
  t.after(() => tooling.dispose())
  const scope = tooling.registry.scope({ allow: jobAgentAllowlist, maxRisk: 'WRITE' }, { agentId: 'codex', signal: new AbortController().signal })
  t.after(() => scope.dispose())
  const requestId = randomUUID(), start = { requestId, jobId: f.job.id, profileId: f.profile.id }
  const { runId } = data<{ runId: string }>(await scope.execute('resume.start', start))
  return { ...f, tooling, scope, start, runId }
}
test('shared tools freeze reads, isolate model scope, preserve caller identity and retry creation exactly once', async t => {
  const f = await resumeTools(t)
  assert.equal(data<{ runId: string }>(await f.scope.execute('resume.start', f.start)).runId, f.runId)
  assert.equal(f.backend.resumes.listRuns({}).total, 1)
  await assert.rejects(f.scope.execute('resume.start', { ...f.start, targetWordCount: 600 }), { code: 'TOOL_CONFLICT' })
  value(await f.api.profiles.editContact({ id: f.profile.id, details: { name: 'LIVE CHANGE', introduction: 'Live introduction' } }))
  value(await f.api.profiles.editFact({ id: f.fact.id, details: { kind: 'SKILL', content: 'LIVE CHANGE' } }))
  const context = data<{ profile: { name: string; introduction: string }; factCount: number }>(await f.scope.execute('resume.get_context', { runId: f.runId }))
  const facts = data<{ items: { content: string }[]; total: number }>(await f.scope.execute('resume.list_facts', { runId: f.runId, limit: 1 }))
  assert.equal(context.profile.introduction, ''); assert.equal(context.profile.name, f.profile.name); assert.equal(context.factCount, 1)
  assert.equal(facts.items[0].content, f.fact.content)
  assert.equal(data<{ items: unknown[] }>(await f.scope.execute('resume.list_facts', { runId: f.runId, offset: 1 })).items.length, 0)
  const read = f.tooling.registry.scope({ allow: ['resume.get_context', 'resume.list_facts'], maxRisk: 'READ' }, { agentId: 'resume', runId: f.runId, signal: new AbortController().signal })
  await assert.rejects(read.execute('resume.publish', { runId: f.runId }), { code: 'TOOL_FORBIDDEN' })
  await assert.rejects(read.execute('resume.get_context', { runId: randomUUID() }), { code: 'TOOL_FORBIDDEN' })
  read.dispose()
})
test('rewrite changes only text, preserves provenance and publishes exactly once', async t => {
  const f = await resumeTools(t), call = (name: string, args = {}) => f.scope.execute(name, { runId: f.runId, ...args })
  const before = f.backend.resumes.getRun({ id: f.runId }).run
  const bullet = before.assembled!.experience[0].bullets[0]
  const request = { bulletId: bullet.id, text: 'Supported wording', requestId: randomUUID() }
  await assert.rejects(call('resume.rewrite_bullet', { ...request, factIds: [] }), { code: 'TOOL_INVALID_INPUT' })
  await assert.rejects(call('resume.rewrite_bullet', { ...request, expectedRevision: 0 }), { code: 'TOOL_INVALID_INPUT' })
  await assert.rejects(call('resume.rewrite_bullet', { ...request, bulletId: randomUUID() }), { code: 'TOOL_INVALID_INPUT' })
  const result = await call('resume.rewrite_bullet', request)
  assert.deepEqual(await call('resume.rewrite_bullet', request), result)
  await assert.rejects(call('resume.rewrite_bullet', { ...request, text: 'Different' }), { code: 'TOOL_CONFLICT' })
  await assert.rejects(call('resume.rewrite_bullet', { ...request, requestId: randomUUID() }), { code: 'TOOL_CONFLICT' })
  const after = f.backend.resumes.getRun({ id: f.runId }).run
  assert.equal(after.stateVersion, before.stateVersion)
  assert.deepEqual(f.backend.rewrittenBulletIds(f.runId), [bullet.id])
  bullet.text = request.text
  assert.deepEqual(after.assembled, before.assembled)
  const first = data<{ artifact: { id: string; content: unknown } }>(await call('resume.publish'))
  assert.deepEqual(data(await call('resume.publish')), first)
  assert.deepEqual(first.artifact.content, before.assembled)
  assert.deepEqual(f.backend.resumes.getArtifact({ id: first.artifact.id }).provenance, [{ blockId: bullet.id, factIds: [f.fact.id] }])
  assert.equal(f.backend.resumes.getRun({ id: f.runId }).run.state, 'PUBLISHED')
  assert.deepEqual(await call('resume.rewrite_bullet', request), result)
  await assert.rejects(call('resume.rewrite_bullet', { ...request, requestId: randomUUID() }), { code: 'TOOL_CONFLICT' })
})

test('distinct bullets change independently; no-ops preserve eligibility and receipts stay immutable', async t => {
  const f = await resumeTools(t)
  value(await f.api.profiles.addFact({ profileId: f.profile.id, profileItemId: f.item.id, details: { kind: 'OTHER', content: 'Second claim' } }))
  const { runId } = data<{ runId: string }>(await f.scope.execute('resume.start', { ...f.start, requestId: randomUUID() }))
  const call = (name: string, args = {}) => f.scope.execute(name, { runId, ...args })
  type Page = { items: { bulletId: string; text: string; rewritten: boolean }[]; total: number }
  const page = data<Page>(await call('resume.list_bullets'))
  assert(!Object.hasOwn(page, 'revision'))
  assert(page.items.every(bullet => bullet.rewritten === false))
  const [first, second] = page.items
  const noop = { bulletId: first.bulletId, text: first.text, requestId: randomUUID() }
  const unchanged = await call('resume.rewrite_bullet', noop)
  assert.equal(data<{ changed: boolean }>(unchanged).changed, false)
  assert.equal(data<Page>(await call('resume.list_bullets')).items[0].rewritten, false)
  const rewrite = { ...noop, text: 'First supported rewrite', requestId: randomUUID() }
  await call('resume.rewrite_bullet', rewrite)
  await call('resume.rewrite_bullet', { bulletId: second.bulletId, text: 'Second supported rewrite', requestId: randomUUID() })
  assert(data<Page>(await call('resume.list_bullets')).items.every(bullet => bullet.rewritten))
  assert.deepEqual(await call('resume.rewrite_bullet', noop), unchanged)
  await assert.rejects(call('resume.rewrite_bullet', { ...rewrite, text: first.text, requestId: randomUUID() }), { code: 'TOOL_CONFLICT' })
  const other = data<{ runId: string }>(await f.scope.execute('resume.start', { ...f.start, requestId: randomUUID() }))
  assert(data<Page>(await f.scope.execute('resume.list_bullets', { runId: other.runId })).items.every(bullet => !bullet.rewritten))
  assert(!Object.hasOwn(f.backend.generationRun(runId), 'rewriteRevision'))
})

test('version 20 receipts retain replay and eligibility after migration, including multiple historical changes', async t => {
  const f = await seed(t), db = new DatabaseSync(':memory:'), transactions = new Transactions(db)
  migrate(db, migrations.slice(0, 20))
  const store = new Store(db), tx = transactions
  tx.write(() => {
    store.insert('job', f.job); store.insert('profile', (({ title: _title, ...profile }) => profile)(f.profile))
    store.insert('profile_item', f.item); store.insert('fact', f.fact)
  })
  const backend = composeBackend({ connection: db, transactions, close: () => db.close() })
  t.after(() => backend.close())
  backend.profiles.addFact({ profileId: f.profile.id, profileItemId: f.item.id, details: { kind: 'OTHER', content: 'Untouched claim' } })
  const run = backend.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id }, { start: true })
  const [first, second] = run.assembled!.experience[0].bullets
  const history = [
    { bulletId: first.id, text: 'Earlier wording', revision: 1, changed: true },
    { bulletId: first.id, text: 'Latest wording', revision: 2, changed: true },
    { bulletId: second.id, text: second.text, revision: 2, changed: false }
  ].map(entry => ({ ...entry, requestId: randomUUID() }))
  first.text = history[1].text
  tx.write(() => {
    db.prepare('UPDATE generation_runs SET assembled_json=?,rewrite_revision=2 WHERE id=?').run(JSON.stringify(run.assembled), run.id)
    for (const entry of history) {
      const hash = createHash('sha256').update(JSON.stringify([entry.bulletId, entry.text, entry.revision - Number(entry.changed)])).digest('hex')
      db.prepare('INSERT INTO resume_bullet_rewrites VALUES(?,?,?,?,?,?)').run(run.id, entry.requestId, hash, entry.bulletId, entry.revision, Number(entry.changed))
    }
  })
  migrate(db)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.deepEqual(backend.rewrittenBulletIds(run.id), [first.id])
  for (const entry of history) {
    const input = { runId: run.id, bulletId: entry.bulletId, text: entry.text, requestId: entry.requestId }
    assert.deepEqual(backend.generation.rewriteBullet(input), { runId: run.id, bulletId: entry.bulletId, changed: entry.changed })
    assert.throws(() => backend.generation.rewriteBullet({ ...input, text: 'Altered retry' }), { code: 'CONFLICT' })
  }
  assert.throws(() => backend.generation.rewriteBullet({ runId: run.id, bulletId: first.id, text: 'Third change', requestId: randomUUID() }), { code: 'CONFLICT' })
  assert.equal(backend.generation.rewriteBullet({ runId: run.id, bulletId: second.id, text: 'First real change', requestId: randomUUID() }).changed, true)
  assert.deepEqual(backend.generationRun(run.id).assembled!.experience[0].bullets.map(bullet => bullet.text), ['Latest wording', 'First real change'])
  migrate(db)
})

test('a failed receipt insert rolls back the bullet change and leaves the same request retryable', async t => {
  const f = await resumeTools(t), before = f.backend.generationRun(f.runId)
  const request = { runId: f.runId, bulletId: before.assembled!.experience[0].bullets[0].id, text: 'Supported wording', requestId: randomUUID() }
  f.database.connection.exec("CREATE TRIGGER reject_rewrite_receipt BEFORE INSERT ON resume_bullet_rewrites BEGIN SELECT RAISE(ABORT,'fixture'); END")
  await assert.rejects(f.scope.execute('resume.rewrite_bullet', request), { code: 'TOOL_CONFLICT' })
  assert.deepEqual(f.backend.generationRun(f.runId), before)
  assert.deepEqual(f.backend.rewrittenBulletIds(f.runId), [])
  f.database.connection.exec('DROP TRIGGER reject_rewrite_receipt')
  const result = data<{ changed: boolean }>(await f.scope.execute('resume.rewrite_bullet', request))
  assert.equal(result.changed, true)
})

test('imported entries with empty titles survive assembly and publication unchanged', async t => {
  const f = await resumeTools(t)
  const types = ['EDUCATION', 'EXPERIENCE', 'PROJECT'] as const
  const imported = value(await f.api.profiles.applyImport({ sessionId: randomUUID(), batchId: randomUUID(), profileId: f.profile.id,
    contact: {}, links: [], items: types.map(type => ({ draftId: randomUUID(), details: { type, title: '', organization: `Saved ${type}`,
      metadata: type === 'EDUCATION' ? { degree: 'Bachelor of Computer Science', isCurrent: true } : {} } })), facts: [] }))
  await Promise.all(imported.items.map(item => f.api.profiles.addFact({ profileId: f.profile.id, profileItemId: item.id,
    details: { kind: 'OTHER', content: `Saved ${item.type} evidence` } }).then(value)))
  const { runId } = data<{ runId: string }>(await f.scope.execute('resume.start', { ...f.start, requestId: randomUUID() }))
  const call = (name: string, args = {}) => f.scope.execute(name, { runId, ...args })
  const { artifact } = data<{ artifact: { content: { education: { title: string; organization: string; degree: string }[];
    experience: { title: string }[]; projects: { title: string }[] } } }>(await call('resume.publish'))
  assert.equal(artifact.content.education[0].title, '')
  assert.equal(artifact.content.education[0].organization, 'Saved EDUCATION')
  assert.equal(artifact.content.education[0].degree, 'Bachelor of Computer Science')
  assert.equal(artifact.content.experience[1].title, '')
  assert.equal(artifact.content.projects[0].title, '')
  assert(imported.items.every(item => item.title === ''))
})

test('oversized snapshots are rejected before creation', async t => {
  const f = await resumeTools(t)
  value(await f.api.profiles.editFact({ id: f.fact.id, details: { kind: 'SKILL', content: 'X'.repeat(9000) } }))
  const before = f.backend.resumes.listRuns({}).total
  await assert.rejects(f.scope.execute('resume.start', { ...f.start, requestId: randomUUID() }), { code: 'TOOL_INVALID_INPUT' })
  assert.equal(f.backend.resumes.listRuns({}).total, before)
})

test('oversized documents fail the copy atomically', async t => {
  const f = await resumeTools(t)
  const item = value(await f.api.profiles.addItem({ profileId: f.profile.id, details: { type: 'PROJECT', title: 'Large project' } }))
  for (let i = 0; i < 99; i++) value(await f.api.profiles.addFact({ profileId: f.profile.id, profileItemId: item.id,
    details: { kind: 'OTHER', content: 'X'.repeat(7900) + i } }))
  const before = f.backend.resumes.listRuns({}).total
  await assert.rejects(f.scope.execute('resume.start', { ...f.start, requestId: randomUUID() }), { code: 'TOOL_INVALID_INPUT' })
  assert.equal(f.backend.resumes.listRuns({}).total, before)
})
