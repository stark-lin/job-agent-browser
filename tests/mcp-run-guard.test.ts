import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { firstPartyFixture } from './first-party-fixture'
import { createFixtureAskTasks, fixtureCapabilities, withPreparation } from './ask-fixture'
import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import { chatDebugExportRepository } from '../src/platform/database/repositories/chat-debug-export'
import { toolSnapshot } from '../src/platform/ai/agent-request'
import { createRunGuardManager } from '../src/platform/mcp-server/run-guard'
import { createMemoryAuthority } from '../src/platform/mcp/memory-authority'
import { createMCPClient } from '../src/platform/mcp/client'
import { ToolError } from '../src/shared/tools/errors'
import type { AgentModelEvent, AgentToolCall } from '../src/shared/agent'
import type { ToolDescriptor } from '../src/shared/tools/tool.types'
const signal = () => new AbortController().signal
const descriptor = (name: string, write = false): ToolDescriptor => ({ name, mode: write ? 'write' : 'read', risk: write ? 'WRITE' : 'READ', source: { type: 'native' }, tags: [], description: name, inputSchema: { type: 'object' } })
const freshGuard = () => createRunGuardManager().forRun({ executionRunId: randomUUID(), sessionId: 'test', signal: signal() })
const output = (value: unknown) => ({ content: [], structuredContent: value as Record<string, string> })
const batch = (calls: AgentToolCall[]): AgentModelEvent[] => [...calls.map(call => ({ type: 'tool_call.ready' as const, call })), { type: 'completed', response: { content: '', toolCalls: calls } }]

test('archive confirmation, canonical arguments, conflict, duplicate and repeated violation preserve the first effect', async t => {
  const f = await firstPartyFixture(t), run = await f.mcp.openAgentRun({ agent: 'ask', agentRunId: randomUUID(), sessionId: 'archive', sourceMessageIds: [], signal: signal() })
  t.after(() => run.close())
  const tools = run.tools, args = { id: f.job.id, archived: true }
  await tools.call('job.set_archived', args, signal())
  await assert.rejects(tools.call('job.set_archived', { archived: false, id: f.job.id }, signal()), { code: 'TOOL_GUARD_CONFLICT' })
  await assert.rejects(tools.call('job.set_archived', { archived: true, id: f.job.id }, signal()), { code: 'TOOL_GUARD_DUPLICATE' })
  await assert.rejects(tools.call('job.set_archived', { ...args, archived: false }, signal()), { code: 'TOOL_GUARD_TERMINATED' })
  const snapshot = tools.getRunGuardSnapshot()!
  assert.equal(snapshot.executed, false); assert.equal(snapshot.status, 'BLOCKED'); assert.equal(snapshot.calls, 4)
  assert.equal(snapshot.executedCalls, 1); assert.equal(snapshot.rejections, 3)

  assert(f.backend.jobs.getJob({ id: f.job.id }).archivedAt)
  await run.close()
  await assert.rejects(tools.call('job.list', {}, signal()))
  const next = await f.askRun(signal(), 'archive')
  await next.call('job.set_archived', { ...args, archived: false }, signal())
  assert.equal(f.backend.jobs.getJob({ id: f.job.id }).archivedAt, null)
})

test('same-Run concurrent writes serialize, while different Runs do not inherit archive effects', async t => {
  const f = await firstPartyFixture(t), tools = await f.askRun(signal(), 'concurrent')
  const results = await Promise.allSettled([true, false].map(archived => tools.call('job.set_archived', { id: f.job.id, archived }, signal())))
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected')
  assert(f.backend.jobs.getJob({ id: f.job.id }).archivedAt)
  await tools.call('job.get', { id: f.job.id }, signal())
  await assert.rejects(f.askRun(signal(), 'independent'), { code: 'TOOL_BUSY' })
  await f.endAskRun()
  const other = await f.askRun(signal(), 'independent')
  await other.call('job.set_archived', { id: f.job.id, archived: false }, signal())
  assert.equal(f.backend.jobs.getJob({ id: f.job.id }).archivedAt, null)
})

test('Run grants reject missing, forged, expired, changed, borrowed, replayed and revoked identities over stdio', async t => {
  const f = await firstPartyFixture(t); await f.mcp.dispose()
  const authority = createMemoryAuthority(f.directory); f.cleanup(() => authority.close())
  async function client(session: string) {
    const c = createMCPClient({ id: session, enabled: true, transport: 'stdio', command: process.execPath, args: [join(f.directory, 'job-agent-mcp.js')], tools: [] }, { closed() {}, changed() {} },
      { processEnv: { JOB_BROWSER_USER_DATA: f.directory, JOB_BROWSER_MEMORY_LAUNCH: await authority.issue(session), ELECTRON_RUN_AS_NODE: '1' } })
    f.cleanup(() => c.close()); await c.connect(); return c
  }
  const a = await client('a'), b = await client('b'), id = randomUUID(), run = authority.registerRun('a', id, 'chat')
  const denied = async (token?: string, args = {}, c = a) => {
    const result = await c.callTool('job.list', args, signal(), { jabRunGrant: token }) as { isError?: boolean; content: { text: string }[] }
    assert.equal(result.isError, true); assert.equal(result.content[0].text, 'TOOL_FORBIDDEN')
  }
  await denied(); await denied('0'.repeat(64))
  const changed = run.grant('job.list', {}); await denied(changed, { archived: true }); await denied(changed)
  const borrowed = run.grant('job.list', {}); await denied(borrowed, {}, b); await denied(borrowed)
  const originalNow = Date.now, past = originalNow() - 31000, clock = t.mock.method(Date, 'now', () => past)
  const expired = run.grant('job.list', {}); clock.mock.restore(); await denied(expired)
  const token = run.grant('job.list', {})
  const ok = await a.callTool('job.list', {}, signal(), { jabRunGrant: token }) as { isError?: boolean }; assert(!ok.isError)
  await denied(token)
  const revoked = run.grant('job.list', {}); await run.close(); await denied(revoked)
  assert.throws(() => run.grant('job.list', {}))
  const next = authority.registerRun('a', randomUUID(), 'chat')
  const fresh = await a.callTool('job.list', {}, signal(), { jabRunGrant: next.grant('job.list', {}) }) as { isError?: boolean }; assert(!fresh.isError)
  await next.close()
})

test('A/B read loops and repeated failures terminate, while unknown success is neutral and budgets reject call 257', async () => {
  const guard = freshGuard(), tool = descriptor('job.get')
  for (const [index, id] of ['a', 'b', 'a', 'b', 'a', 'b'].entries()) {
    const result = await guard.execute(tool, { id }, signal(), async () => output({ job: { id }, sources: [] }))
    assert.equal(result.guard.status, index === 5 ? 'BLOCKED' : 'ACTIVE')
  }
  const stopped = await guard.execute(tool, { id: 'c' }, signal(), async () => assert.fail('blocked'))
  assert.equal(stopped.error?.code, 'TOOL_GUARD_TERMINATED')
  const failing = freshGuard()
  for (let i = 0; i < 4; i++) {
    const result = await failing.execute(tool, {}, signal(), async () => { throw new ToolError('TOOL_NOT_FOUND') })
    assert.equal(result.error?.code, 'TOOL_NOT_FOUND')
    assert.equal(result.guard.status, i === 3 ? 'BLOCKED' : 'ACTIVE')
  }
  const budget = freshGuard(), unknown = descriptor('future.write', true)
  for (let i = 0; i < 256; i++) assert.equal((await budget.execute(unknown, {}, signal(), async () => output({ ok: true }))).guard.status, 'ACTIVE')
  const exhausted = await budget.execute(unknown, {}, signal(), async () => assert.fail('budget'))
  assert.equal(exhausted.guard.executedCalls, 256); assert.equal(exhausted.guard.reason, 'CALL_BUDGET_EXCEEDED')
})

test('uncertain writes block without inventing a confirmed effect or changing their error', async () => {
  const guard = freshGuard()
  const result = await guard.execute(descriptor('job.set_archived', true), { id: randomUUID(), archived: true }, signal(), async () => { throw new ToolError('TOOL_TIMEOUT') })
  assert.equal(result.error?.code, 'TOOL_TIMEOUT'); assert.equal(result.guard.reason, 'WRITE_OUTCOME_UNKNOWN'); assert.deepEqual(result.guard.effects, [])
})

for (const mode of ['archive', 'read'] as const) test(`Pi ${mode} circuit break stops later batch calls and persists truthful diagnostics`, async t => {
  const f = await firstPartyFixture(t); let requests = 0
  const calls: AgentToolCall[] = mode === 'archive'
    ? [true, false, true, false].map((archived, i) => ({ id: `archive-${i}`, name: 'job.set_archived', arguments: { id: f.job.id, archived } }))
    : Array.from({ length: 4 }, (_, i) => ({ id: `read-${i}`, name: 'job.list', arguments: {} }))
  calls.push({ id: 'never', name: 'job.set_archived', arguments: { id: f.job.id, archived: false } })
  const tasks = createFixtureAskTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => ({ complete: async () => assert.fail('no summary'), async *stream() {
    requests++
    if (requests === 1) yield* batch(calls)
    else if (mode === 'read' && requests === 2) yield* batch([calls[0], calls.at(-1)!].map((call, i) => ({ ...call, id: `retry-${i}` })))
    else assert.fail('no inference after termination')
  } }) }); t.after(() => tasks.dispose())
  const input = { requestId: randomUUID(), message: 'Run guard regression', choice: { providerId: 'fixture', modelId: 'test' } }, ids = tasks.start(1, input, () => {})
  assert.deepEqual(tasks.start(1, input, () => {}), ids)
  for (let i = 0; i < 500 && tasks.getRun(1, { runId: ids.runId }).run.state === 'running'; i++) await new Promise(r => setTimeout(r, 10))
  const snapshot = f.backend.chats.snapshot(ids.runId), tools = snapshot.items.filter(i => i.content.type === 'tool_call' && !i.content.toolName.startsWith('scope.'))
  assert.equal(snapshot.run.error, 'TOOL_GUARD_TERMINATED'); assert.equal(requests, mode === 'read' ? 2 : 1); assert.equal(tools.length, mode === 'read' ? 5 : 4)
  assert(tools.every(i => i.state !== 'uncertain'))
  const last = tools.at(-1)!
  assert(last.content.type === 'tool_call' && last.content.guard?.status === 'BLOCKED')
  assert.equal(last.state, mode === 'read' ? 'completed' : 'failed')

  assert.equal(Boolean(f.backend.jobs.getJob({ id: f.job.id }).archivedAt), mode === 'archive')
  assert(!JSON.stringify(snapshot).includes('jabRunGrant'))
  f.backend.chats.deleteSession(ids.sessionId)
  assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM agent_items WHERE run_id=?').get(ids.runId)?.n, 0)
})

for (const recovery of ['warning-answer', 'answer', 'source', 'discovery'] as const) test(`Pi no-progress ${recovery} preserves results and skips the old batch without writes`, async t => {
  const f = await firstPartyFixture(t); let requests = 0
  const reads = Array.from({ length: recovery === 'warning-answer' ? 3 : 4 }, (_, n) => ({ id: `read-${n}`, name: 'job.list', arguments: {} }))
  const tasks = createFixtureAskTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => ({ complete: async () => assert.fail('no summary'), async *stream(input) {
    requests++
    if (requests === 1) {
      const calls: AgentToolCall[] = [...reads, ...(recovery === 'warning-answer' ? [] : [
        { id: 'skip-write', name: 'application.add_note', arguments: { jobId: f.job.id, requestId: randomUUID(), text: 'Never execute this note' } },
        { id: 'skip-search', name: 'scope.application', arguments: {} }
      ])]
      yield* batch(calls); return
    }
    assert(input.messages.some(m => m.role === 'tool' && m.content.includes('RunGuard guidance:')))
    if (requests === 2 && recovery === 'source') { yield* batch([{ id: 'fresh-source', name: 'profile.list', arguments: {} }]); return }
    if (requests === 2 && recovery === 'discovery') { yield* batch([{ id: 'discover-source', name: 'scope.profile', arguments: {} }]); return }
    if (requests === 3 && recovery === 'discovery') { yield* batch([{ id: 'fresh-source', name: 'profile.list', arguments: {} }]); return }
    yield { type: 'content.delta', text: 'Confirmed information is sufficient.' }
    yield { type: 'completed', response: { content: 'Confirmed information is sufficient.', toolCalls: [] } }
  } }) }); t.after(() => tasks.dispose())
  const ids = tasks.start(1, { requestId: randomUUID(), message: 'Inspect saved data', choice: { providerId: 'fixture', modelId: 'test' } }, () => {})
  for (let n = 0; n < 500 && tasks.getRun(1, { runId: ids.runId }).run.state === 'running'; n++) await new Promise(r => setTimeout(r, 10))
  const snapshot = f.backend.chats.snapshot(ids.runId)
  assert.equal(snapshot.run.state, 'completed', snapshot.run.error ?? '')
  assert.equal(snapshot.run.writeStarted, false)
  assert(!snapshot.items.some(i => i.content.type === 'tool_call' && ['application.add_note'].includes(i.content.toolName)))

  const completed = snapshot.items.filter(i => i.content.type === 'tool_call' && i.content.toolName === 'job.list')
  assert.equal(completed.length, reads.length)
  assert(completed.every(i => i.content.type === 'tool_call' && i.state === 'completed' && i.content.result && i.content.guard?.executed))
  const last = completed.at(-1)!
  assert(last.content.type === 'tool_call'); assert.equal(last.content.guard?.level, recovery === 'warning-answer' ? 'warning' : 'recovery')
  if (recovery === 'source' || recovery === 'discovery') {
    const source = snapshot.items.find(i => i.content.type === 'tool_call' && i.content.toolName === 'profile.list')
    assert(source?.content.type === 'tool_call'); assert.equal(source.content.guard?.noProgress, 0)
  }
})

test('real stdio stops a 62-call Recall loop with changing queries after five executed reads', async t => {
  const f = await firstPartyFixture(t)
  await f.workspace.spaces.memory.files.write('loop.md', '# Projects\n\nProjects use TypeScript and reliable tooling.', null)
  const tools = await f.askRun(signal(), 'recall-loop')
  for (let n = 0; n < 62; n++) {
    const attempt = () => tools.call('memory.recall', { query: `projects ${n}` }, signal())
    if (n < 5) {
      const result = await attempt() as { sources: { path: string }[] }
      assert(result.sources.some(s => s.path === 'loop.md'))
    } else await assert.rejects(attempt(), { code: 'TOOL_GUARD_TERMINATED' })
  }
  assert.equal(tools.getRunGuardSnapshot()?.executedCalls, 5)
})

test('schema failures do not consume Guard state; tool-specific large inputs and bound child views retain their contracts', async t => {
  const f = await firstPartyFixture(t), tools = await f.askRun(signal(), 'limits', [randomUUID()])
  await assert.rejects(tools.call('job.list', { extra: true }, signal()), { code: 'TOOL_INVALID_INPUT' })
  await tools.call('job.list', {}, signal()); assert.equal(tools.getRunGuardSnapshot()?.calls, 1)
  const description = 'x'.repeat(70000)
  const saved = await tools.call('job.import', { requestId: randomUUID(), details: { title: 'Large valid input', companyNameRaw: 'Fixture', description } }, signal()) as { id: string }
  assert.equal(f.backend.jobs.getJob({ id: saved.id }).description.length, description.length)
  const child = tools.view(['memory.write', 'memory.read'])
  await child.call('memory.write', { path: 'bound.md', content: 'Source-bound child view', expectedRevision: null }, signal())
  assert.equal((await child.call('memory.read', { path: 'bound.md' }, signal()) as { content: string }).content, 'Source-bound child view')
  assert.equal(child.getRunGuardSnapshot()?.executionRunId, tools.getRunGuardSnapshot()?.executionRunId)
})

test('Run cancellation fences queued dispatch and session retirement cannot revive an old Run', async t => {
  const controller = new AbortController(), manager = createRunGuardManager(), id = randomUUID()
  const guard = manager.forRun({ executionRunId: id, sessionId: 'cancel', signal: controller.signal })
  let release!: () => void, began!: () => void
  const started = new Promise<void>(r => { began = r }), ready = new Promise<void>(r => { release = r })
  const first = guard.execute(descriptor('unknown.read'), {}, signal(), async () => { began(); await ready; return output({}) })
  await started
  const second = guard.execute(descriptor('unknown.read'), {}, signal(), async () => assert.fail('cancelled queued dispatch'))
  const rejected = assert.rejects(second, { code: 'TOOL_CANCELLED' })
  controller.abort(); release(); await first; await rejected; await manager.close(id)
  assert.throws(() => manager.forRun({ executionRunId: id, sessionId: 'cancel', signal: controller.signal }), { code: 'TOOL_CANCELLED' })
  const f = await firstPartyFixture(t), run = await f.mcp.openAgentRun({ agent: 'ask', agentRunId: randomUUID(), sessionId: 'retire', sourceMessageIds: [], signal: signal() })
  await run.tools.close()
  await assert.rejects(run.close(), { code: 'TOOL_UNAVAILABLE' })
  const next = await f.askRun(signal(), 'retire')
  await next.call('job.list', {}, signal())
  assert.equal(next.getRunGuardSnapshot()?.calls, 1)
  await assert.rejects(run.tools.call('job.list', {}, signal()))
})

for (const ending of ['blocked', 'fresh-evidence', 'same-batch'] as const) test(`JAB-2026-004: profile.list repetition is governed by Cycle state (${ending})`, async t => {
  const f = await firstPartyFixture(t)
  let requests = 0
  const read = (id: string, name = 'profile.list') => ({ id, name, arguments: {} })
  const skip = { id: 'skip-write', name: 'application.add_note', arguments: { jobId: f.job.id, requestId: randomUUID(), text: 'Never execute' } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, language: () => 'en', capabilities: async () => fixtureCapabilities, model: () => withPreparation({ complete: async () => assert.fail('no summary'), async *stream(input) {
    input.onRequestPrepared?.({ providerId: 'fixture', modelId: 'test', preparedAt: 'now', tools: toolSnapshot(input.tools) })
    const system = input.messages.find(message => message.role === 'system')?.content ?? ''
    switch (++requests) {
      case 1: yield* batch(['profile', 'job', 'application'].map(domain => ({ id: `discover-${domain}`, name: `scope.${domain}`, arguments: {} }))); return
      case 2: yield* batch([read('first'), read('repeat-1'), read('repeat-2'), ...(ending === 'same-batch' ? [read('fresh', 'job.list')] : [])]); return
      case 3:
        if (ending === 'same-batch') {
          assert.doesNotMatch(system, /Runtime RunGuard warning:/)
          yield { type: 'content.delta', text: 'Fresh evidence in this batch.' }
          yield { type: 'completed', response: { content: 'Fresh evidence in this batch.', toolCalls: [] } }; return
        }
        assert.match(system, /Runtime RunGuard warning:/)
        yield* batch([{ id: 'reactivate', name: 'scope.profile', arguments: {} }]); return
      case 4:
        assert.match(system, /Runtime RunGuard warning:/)
        yield* batch([read('repeat-3'), skip]); return
      case 5:
        assert.match(system, /Runtime RunGuard recovery:/)
        yield* batch([read('after-recovery', ending === 'blocked' ? 'profile.list' : 'job.list'), ...(ending === 'blocked' ? [{ ...skip, id: 'skip-after-block' }] : [])]); return
      case 6:
        assert.equal(ending, 'fresh-evidence')
        assert.doesNotMatch(system, /Runtime RunGuard (warning|recovery):/)
        yield { type: 'content.delta', text: 'New evidence confirmed.' }
        yield { type: 'completed', response: { content: 'New evidence confirmed.', toolCalls: [] } }; return
      default: assert.fail('no inference after terminal state')
    }
  } }) })
  t.after(() => tasks.dispose())
  const ids = tasks.start(1, { requestId: randomUUID(), message: 'Inspect profiles', choice: { providerId: 'fixture', modelId: 'test' } }, event => {
    if (event.type === 'item.completed' && event.item.content.type === 'tool_call' && event.item.content.guard?.status === 'BLOCKED') tasks.cancel(1, { runId: event.runId })
  })
  for (let n = 0; n < 500 && tasks.getRun(1, { runId: ids.runId }).run.state === 'running'; n++) await new Promise(resolve => setTimeout(resolve, 10))
  const snapshot = tasks.getRun(1, { runId: ids.runId })
  const { cycles, cycleStatus } = chatDebugExportRepository(f.database.connection).getDebugBundle(ids.sessionId).runs.find(entry => entry.run.id === ids.runId)!
  assert.equal(snapshot.run.state, ending === 'blocked' ? 'failed' : 'completed', snapshot.run.error ?? '')
  assert.equal(cycleStatus, ending === 'blocked' ? 'FAILED' : 'SUCCESS')
  const businessCycles = cycles.filter(c => c.phase === 'execute' && !c.toolCallIds.some(id => id.startsWith('discover-')))
  if (ending === 'same-batch') {
    assert.deepEqual(businessCycles.map(c => c.status), ['CONTINUE', 'SUCCESS'])
    assert(snapshot.items.some(item => item.content.type === 'tool_call' && item.content.guard?.level === 'warning'))
    assert.equal(requests, 3)
    return
  }
  assert.deepEqual(businessCycles.map(c => c.status), ['WARNING', 'WARNING', 'RECOVERING', ...(ending === 'blocked' ? ['FAILED'] : ['CONTINUE', 'SUCCESS'])])
  assert.deepEqual(businessCycles[0].toolCallIds, ['first', 'repeat-1', 'repeat-2'])
  assert.deepEqual(businessCycles[2].toolCallIds, ['repeat-3', 'skip-write'])
  assert.deepEqual(cycles.map(c => c.modelRequestOrdinal), cycles.map(c => c.index))
  assert.equal(requests, ending === 'blocked' ? 5 : 6)
  assert.equal(snapshot.run.writeStarted, false)

  if (ending === 'blocked') {
    assert.equal(snapshot.run.error, 'TOOL_GUARD_TERMINATED')
    assert.equal(cycles.at(-1)?.reason, 'NO_PROGRESS_LOOP')
  }
})
