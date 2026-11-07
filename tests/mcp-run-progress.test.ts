import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRunGuardManager } from '../src/platform/mcp-server/run-guard'
import { guardNextAction, parseRunGuard } from '../src/shared/agent/run-guard'
import type { JsonValue, ToolDescriptor, ToolOutput } from '../src/shared/tools/tool.types'

const signal = () => new AbortController().signal
const guard = () => createRunGuardManager().forRun({ agentRunId: randomUUID(), sessionId: 'progress', signal: signal() })
const tool = (name: string): ToolDescriptor => ({ name, mode: 'read', risk: 'READ', source: { type: 'native' }, description: name, tags: [], inputSchema: { type: 'object' } })
const output = (value: unknown): ToolOutput => ({ content: [], structuredContent: value as JsonValue })
const source = (path = 'CORE.md', startLine = 1, endLine = 3, revision = 'rev-a') => ({ path, startLine, endLine, revision, content: 'Supported evidence' })

test('resume progress counts each changed run and bullet once, including receipt replay', async () => {
  const run = guard(), write = { ...tool('resume.rewrite_bullet'), mode: 'write' as const, risk: 'WRITE' as const }
  const rewrite = (runId: string, bulletId: string, changed = true) =>
    run.execute(write, { runId, bulletId }, signal(), async () => output({ runId, bulletId, changed }))
  await rewrite('one', 'first')
  assert.equal((await rewrite('one', 'first')).guard.noProgress, 1)
  assert.equal((await rewrite('one', 'second', false)).guard.noProgress, 2)
  assert.equal((await rewrite('one', 'second')).guard.noProgress, 0)
  assert.equal((await rewrite('two', 'first')).guard.progress, 3)
})

test('62 reformulated recalls stop after five reads, then every call is rejected before execution', async () => {
  const run = guard(); let executed = 0
  for (let n = 0; n < 62; n++) {
    const result = await run.execute(tool('memory.recall'), { query: `projects query ${n}` }, signal(), async () => {
      executed++; return output({ sources: n % 2 ? [source('goals.md'), source()] : [source(), source('goals.md')], text: `display ${n}`, semantic: Boolean(n % 2) })
    })
    assert.equal(result.guard.status, n < 4 ? 'ACTIVE' : 'BLOCKED')
    if (n === 2) { assert.equal(result.guard.level, 'warning'); assert.equal(result.guard.nextAction, guardNextAction) }
    if (n === 3) assert.equal(result.guard.level, 'recovery')
    if (n > 4) { assert.equal(result.guard.executed, false); assert.equal(result.error?.code, 'TOOL_GUARD_TERMINATED') }
    assert(!JSON.stringify(result.guard).includes('CORE.md'))
  }
  assert.equal(executed, 5)
})

test('search, retrieve and full reads share covered ranges, while new portions and revisions advance', async () => {
  const run = guard()
  const read = async (name: string, value: unknown) => (await run.execute(tool(name), {}, signal(), async () => output(value))).guard
  assert.equal((await read('knowledge.search', { items: [{ ...source(), id: 'chunk', score: 1 }] })).progress, 1)
  assert.equal((await read('knowledge.retrieve', { sources: [source('CORE.md', 2, 3)] })).noProgress, 1)
  assert.equal((await read('knowledge.search', { items: [{ ...source(), score: 999 }] })).noProgress, 2)
  assert.equal((await read('knowledge.retrieve', { sources: [source('CORE.md', 3, 5)] })).noProgress, 0)
  assert.equal((await read('knowledge.retrieve', { sources: [source('CORE.md', 1, 5)] })).noProgress, 1)
  assert.equal((await read('knowledge.read', { path: 'CORE.md', revision: 'rev-a', content: 'a\nb\nc\nd\ne\nf' })).noProgress, 0)
  assert.equal((await read('knowledge.retrieve', { sources: [source('CORE.md', 4, 6)] })).noProgress, 1)
  assert.equal((await read('knowledge.retrieve', { sources: [source('CORE.md', 1, 3, 'rev-b')] })).noProgress, 0)
  assert.equal((await read('memory.recall', { sources: [source('CORE.md', 1, 3, 'rev-b')] })).noProgress, 0)
})

test('a full read of already retrieved lines adds no evidence and adjacent ranges merge', async () => {
  const run = guard()
  for (const [start, end] of [[1, 2], [3, 4]]) await run.execute(tool('knowledge.retrieve'), {}, signal(), async () => output({ sources: [source('notes.md', start, end)] }))
  const result = await run.execute(tool('knowledge.read'), {}, signal(), async () => output({ path: 'notes.md', revision: 'rev-a', content: 'a\nb\nc\nd' }))
  assert.equal(result.guard.noProgress, 1)
})

test('entity unions tolerate pagination and new facts without counting subsets, ordering or bookkeeping dates', async () => {
  const run = guard(), fact = (id: string, content = id) => ({ id, profileId: 'profile', content, updatedAt: randomUUID() })
  const read = async (items: unknown[], offset = 0) => (await run.execute(tool('profile.list_facts'), { profileId: 'profile', offset }, signal(), async () => output({ items, total: 3 }))).guard
  assert.equal((await read([fact('a'), fact('b')])).progress, 1)
  assert.equal((await read([fact('b')], 1)).noProgress, 1)
  assert.equal((await read([fact('b'), fact('a')])).noProgress, 2)
  assert.equal((await read([fact('c')], 2)).noProgress, 0)
  assert.equal((await read([fact('a', 'changed')])).noProgress, 0)
  const p = await run.execute(tool('profile.get'), { id: 'profile' }, signal(), async () => output({ id: 'profile', revision: 1, name: 'Ada' }))
  const revised = await run.execute(tool('profile.get'), { id: 'profile' }, signal(), async () => output({ id: 'profile', revision: 2, name: 'Ada' }))
  assert.equal(revised.guard.progress, p.guard.progress + 1)
})

test('recombining a finite evidence set and empty queries cannot reset progress', async () => {
  const run = guard()
  for (const sources of [[source(), source('goals.md')], [source()], [source('goals.md')], [source('goals.md'), source()], [source()]])
    await run.execute(tool('memory.recall'), {}, signal(), async () => output({ sources }))
  assert.equal(run.snapshot().status, 'BLOCKED')
  const empty = guard()
  for (let n = 0; n < 5; n++) await empty.execute(tool('knowledge.search'), { query: String(n), limit: n + 1 }, signal(), async () => output({ items: [], total: 0 }))
  assert.equal(empty.snapshot().status, 'BLOCKED')
  const scoped = guard()
  for (const profileId of ['one', 'two']) await scoped.execute(tool('profile.list_facts'), { profileId }, signal(), async () => output({ items: [], total: 0 }))
  assert.equal(scoped.snapshot().progress, 2)
})

test('unknown READ results participate, retaining unknown timestamps and array ordering', async () => {
  const run = guard()
  for (let n = 0; n < 5; n++) await run.execute(tool('future.read'), { query: String(n) }, signal(), async () => output(n % 2 ? { b: 2, a: 1 } : { a: 1, b: 2 }))
  assert.equal(run.snapshot().status, 'BLOCKED')
  const texts = guard()
  for (let n = 0; n < 5; n++) await texts.execute(tool('future.read'), { query: String(n) }, signal(), async () => ({ content: [{ type: 'text', text: 'same' }] }))
  assert.equal(texts.snapshot().status, 'BLOCKED')
  const ordered = guard()
  for (const value of [{ items: [1, 2], timestamp: 1 }, { items: [2, 1], timestamp: 1 }, { items: [2, 1], timestamp: 2 }])
    await ordered.execute(tool('future.read'), {}, signal(), async () => output(value))
  assert.equal(ordered.snapshot().progress, 3)
})

test('guard metadata accepts historical snapshots and only the fixed recovery advice', async () => {
  const run = guard(), historical = run.snapshot()
  assert.deepEqual(parseRunGuard(historical), historical)
  for (let n = 0; n < 4; n++) await run.execute(tool('future.read'), {}, signal(), async () => output({ ok: true }))
  assert.deepEqual(parseRunGuard(run.snapshot()), JSON.parse(JSON.stringify(run.snapshot())))
  assert.equal(parseRunGuard({ ...historical, level: 'recovery' }), undefined)
  assert.equal(parseRunGuard({ ...run.snapshot(), nextAction: 'arbitrary instructions' }), undefined)
})

test('changing failed-read arguments cannot avoid recovery; confirmed mutations clear the streak', async () => {
  const run = guard()
  for (let n = 0; n < 3; n++) await run.execute(tool('memory.read'), { path: `missing-${n}.md` }, signal(), async () => { throw new Error('unavailable') })
  assert.equal(run.snapshot().level, 'recovery')
  const write = { ...tool('memory.write'), mode: 'write' as const, risk: 'WRITE' as const }
  const saved = await run.execute(write, { path: 'new.md' }, signal(), async () => output({ path: 'new.md', revision: 'new-revision' }))
  assert.equal(saved.guard.noProgress, 0); assert.equal(saved.guard.level, undefined)
  const stopped = guard()
  for (let n = 0; n < 4; n++) await stopped.execute(tool('memory.read'), { path: `missing-${n}.md` }, signal(), async () => { throw new Error('unavailable') })
  assert.equal(stopped.snapshot().status, 'BLOCKED')
})

test('concurrent read dispatch is serialized and cannot execute after the circuit opens', async () => {
  const run = guard(); let executed = 0
  const results = await Promise.all(Array.from({ length: 10 }, (_, n) => run.execute(tool('future.read'), { query: String(n) }, signal(), async () => {
    executed++; return output({ stable: true })
  })))
  assert.equal(executed, 5)
  assert(results.slice(5).every(r => r.guard.executed === false && r.error?.code === 'TOOL_GUARD_TERMINATED'))
})

test('flat Job reads share list evidence and ignore bookkeeping-only changes', async () => {
  const run = guard(), job = { id: 'job', title: 'Engineer', applicationStatus: 'NOT_STARTED' }
  await run.execute(tool('job.list'), {}, signal(), async () => output({ items: [job], total: 1 }))
  const same = await run.execute(tool('job.get'), { id: job.id }, signal(), async () => output({ ...job, updatedAt: randomUUID() }))
  assert.equal(same.guard.noProgress, 1)
  const changed = await run.execute(tool('job.get'), { id: job.id }, signal(), async () => output({ ...job, title: 'Senior Engineer' }))
  assert.equal(changed.guard.noProgress, 0)
})
