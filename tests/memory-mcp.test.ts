import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { symlink } from 'node:fs/promises'
import { firstPartyFixture } from './first-party-fixture'
import { createMCPClient } from '../src/platform/mcp/client'
import { createMemoryAuthority } from '../src/platform/mcp/memory-authority'
import { approximateTokens } from '../src/platform/knowledge/rag/chunker'
import { validateDescriptor } from '../src/shared/tools/policy'
import { askToolAllowlist } from '../src/shared/agent/ask-policy'
import { jobAgentAllowlist } from '../src/platform/tools'
const signal = new AbortController().signal
const names = ['memory.list', 'memory.recall', 'memory.read', 'memory.write', 'memory.mkdir']
function external(f: Awaited<ReturnType<typeof firstPartyFixture>>, launch?: string, caller = 'internal.ask-ai') {
  const client = createMCPClient({ id: 'spoofed', enabled: true, transport: 'stdio', command: process.execPath, args: [join(f.directory, 'job-agent-mcp.js')], tools: [] }, { changed() {}, closed() {} }, {
    processEnv: { JOB_BROWSER_USER_DATA: f.directory, JOB_BROWSER_MCP_CALLER: caller, ELECTRON_RUN_AS_NODE: '1', ...(launch === undefined ? {} : { JOB_BROWSER_MEMORY_LAUNCH: launch }) }
  })
  f.cleanup(() => client.close()); return client
}
test('authenticated Ask AI sessions expose all five Memory tools; writes require source grants; caller labels and hidden direct calls grant nothing', async t => {
  const f = await firstPartyFixture(t), ask = await f.mcp.session('ask-ai', signal, 'chat-a')
  assert.deepEqual((await ask.list()).filter(x => x.name.startsWith('memory.')).map(x => x.name).sort(), names.sort())
  for (const agent of ['resume', 'application', 'job-capture'] as const) {
    assert(!(await (await f.mcp.session(agent, signal)).list()).some(x => x.name.startsWith('memory.')))
  }
  const spoofed = external(f); await spoofed.connect()
  assert(!(await spoofed.listTools()).some(x => x.name.startsWith('memory.')))
  const hidden = await spoofed.callTool('memory.write', { path: 'private.md', content: 'forbidden', expectedRevision: null }, signal) as { isError: boolean; content: { text: string }[] }
  assert(hidden.isError); assert.equal(hidden.content[0].text, 'TOOL_FORBIDDEN')
  const [one, two] = await Promise.all([f.mcp.session('ask-ai', signal, 'same-session'), f.mcp.session('ask-ai', signal, 'same-session')])
  assert.equal(one, two)
})
test('Memory MCP fixes the physical space, rejects unsafe paths, stale/missing revisions and unprovided operations; audits omit bodies and queries', async t => {
  const f = await firstPartyFixture(t), reader = await f.askRun(signal), ask = await f.askRun(signal, 'writer', [randomUUID()])
  await reader.call('knowledge.write', { path: 'same.md', content: 'Knowledge SECRET_K', expectedRevision: null }, signal)
  const memory = await ask.call('memory.write', { path: 'same.md', content: '# Memory\nSECRET_M pineapple', expectedRevision: null }, signal) as { revision: string }
  assert.notEqual(memory.revision, '')
  const read = await ask.call('memory.read', { path: 'same.md' }, signal) as { content: string }
  assert(read.content.includes('SECRET_M')); assert(!read.content.includes('SECRET_K'))
  const recalled = await ask.call('memory.recall', { query: 'pineapple' }, signal) as { text: string }
  assert(recalled.text.includes('SECRET_M')); assert(!recalled.text.includes('SECRET_K'))
  await ask.call('memory.write', { path: 'budget.md', content: Array.from({ length: 12 }, (_, i) => `# Pineapple section ${i}\n\n${'pineapple context '.repeat(250)}\n\n`).join(''), expectedRevision: null }, signal)
  const budgeted = await ask.call('memory.recall', { query: 'pineapple context' }, signal) as { text: string; truncated: boolean }
  assert(approximateTokens(budgeted.text) <= 2048); assert(budgeted.truncated)
  const listed = await ask.call('memory.list', {}, signal) as { items: { path: string }[] }
  assert(listed.items.some(x => x.path === 'same.md'))
  for (const args of [
    { path: '../knowledge/same.md' }, { path: '/tmp/same.md' }, { path: 'same.md', space: 'knowledge' }, { path: 'same.md', root: '/tmp' }
  ]) await assert.rejects(ask.call('memory.read', args, signal), { code: 'TOOL_INVALID_INPUT' })
  await assert.rejects(ask.call('memory.write', { path: 'same.md', content: 'overwrite' }, signal), { code: 'TOOL_INVALID_INPUT' })
  await assert.rejects(ask.call('memory.write', { path: 'same.md', content: 'overwrite', expectedRevision: null }, signal), { code: 'TOOL_CONFLICT' })
  for (const operation of ['delete', 'move', 'patch']) await assert.rejects(ask.call(`memory.${operation}`, {}, signal), { code: 'TOOL_FORBIDDEN' })
  await symlink(f.workspace.files.root, join(f.workspace.spaces.memory.files.root, 'link'))
  await assert.rejects(ask.call('memory.read', { path: 'link/same.md' }, signal), { code: 'TOOL_INVALID_INPUT' })
  const audit = f.backend.toolAudit.list(), text = JSON.stringify(audit)
  for (const secret of ['SECRET_K', 'SECRET_M', 'pineapple', 'same.md']) assert(!text.includes(secret))
  assert(audit.some(row => row.target_type === 'memory'))
  for (const namespace of ['knowledge', 'memory']) assert.throws(() => validateDescriptor({ name: `${namespace}.read`, description: 'spoof', inputSchema: { type: 'object' }, source: { type: 'mcp', serverId: 'external', originalName: 'read' }, tags: [], mode: 'read', risk: 'READ' }))
})
test('invalid, mismatched, replayed and previous-Main launch credentials fail closed over real stdio', async t => {
  const f = await firstPartyFixture(t)
  await f.mcp.dispose()
  const authority = createMemoryAuthority(f.directory); f.cleanup(() => authority.close())
  const credential = await authority.issue('chat-credential'), parsed = JSON.parse(credential)
  const invalid = external(f, JSON.stringify({ ...parsed, credential: '0'.repeat(64) }))
  await assert.rejects(invalid.connect())
  const mismatched = external(f, JSON.stringify({ ...parsed, session: 'other-chat' }))
  await assert.rejects(mismatched.connect())
  const fresh = await authority.issue('new-chat'), valid = external(f, fresh)
  await valid.connect(); assert((await valid.listTools()).some(x => x.name === 'memory.recall'))
  const replay = external(f, fresh); await assert.rejects(replay.connect())
  const previous = await authority.issue('previous-main')
  await authority.close()
  await assert.rejects(valid.callTool('memory.read', { path: 'README.md' }, signal))
  const restarted = createMemoryAuthority(f.directory); f.cleanup(() => restarted.close()); await restarted.issue('new-main')
  const stale = external(f, previous); await assert.rejects(stale.connect())
})

test('server-side Ask grants bind exact inputs and cannot be replayed or borrowed by the Ask session', async t => {
  const f = await firstPartyFixture(t); await f.mcp.dispose()
  const authority = createMemoryAuthority(f.directory); f.cleanup(() => authority.close())
  const writer = external(f, await authority.issue('writer-session'))
  await writer.connect()
  const run = authority.registerRun('writer-session', randomUUID(), 'writer-chat')
  const payload = { path: 'grant.md', content: 'Source-backed memory.', expectedRevision: null }
  const denied = await writer.callTool('memory.write', payload, signal) as { isError: boolean }; assert(denied.isError)
  const token = authority.grant('writer-session', 'memory.write', payload, ['user-source'])
  const changed = await writer.callTool('memory.write', { ...payload, content: 'Changed input' }, signal, { jabMemoryGrant: token, jabRunGrant: run.grant('memory.write', { ...payload, content: 'Changed input' }) }) as { isError: boolean }; assert(changed.isError)
  const consumed = await writer.callTool('memory.write', payload, signal, { jabMemoryGrant: token, jabRunGrant: run.grant('memory.write', payload) }) as { isError: boolean }; assert(consumed.isError)
  const valid = authority.grant('writer-session', 'memory.write', payload, ['user-source'])
  const result = await writer.callTool('memory.write', payload, signal, { jabMemoryGrant: valid, jabRunGrant: run.grant('memory.write', payload) }) as { isError?: boolean }; assert(!result.isError)
  const replay = await writer.callTool('memory.write', payload, signal, { jabMemoryGrant: valid, jabRunGrant: run.grant('memory.write', payload) }) as { isError: boolean }; assert(replay.isError)
  const ask = external(f, await authority.issue('ask-session'))
  await ask.connect()
  const otherRun = authority.registerRun('ask-session', randomUUID(), 'other-chat')
  const borrowed = authority.grant('writer-session', 'memory.write', { ...payload, path: 'other.md' }, ['user-source'])
  for (const [name, args, grant] of [['memory.write', { ...payload, path: 'other.md' }, borrowed], ['knowledge.delete', { path: 'README.md', expectedRevision: 'a'.repeat(64), recursive: false }, undefined]] as const) {
    const reply = await ask.callTool(name, args, signal, { jabMemoryGrant: grant, jabRunGrant: otherRun.grant(name, args) }) as { isError: boolean }; assert(reply.isError)
  }
})

test('reused Ask transport has distinct immutable per-turn grants; cancellation revokes only the old turn', async t => {
  const f = await firstPartyFixture(t), controller = new AbortController(), sources = [randomUUID()]
  const first = await f.askRun(controller.signal, 'reused', sources)
  sources.length = 0
  await first.call('memory.write', { path: 'first-turn.md', content: 'First', expectedRevision: null }, signal)
  controller.abort()
  const second = await f.askRun(signal, 'reused', [randomUUID()])
  assert.notEqual(first, second)
  await assert.rejects(first.call('memory.write', { path: 'forbidden.md', content: 'Old turn', expectedRevision: null }, signal))
  await second.call('memory.write', { path: 'second-turn.md', content: 'Second', expectedRevision: null }, signal)
  const unbound = await f.mcp.session('ask-ai', signal, 'reused')
  await assert.rejects(unbound.call('memory.write', { path: 'unbound.md', content: 'Missing source', expectedRevision: null }, signal), { code: 'TOOL_FORBIDDEN' })
  assert.equal((await second.call('memory.read', { path: 'second-turn.md' }, signal) as { content: string }).content, 'Second')
  await assert.rejects(second.call('memory.read', { path: 'missing.md' }, signal), { code: 'TOOL_NOT_FOUND' })
})

test('trusted Ask policy denies every resume/build tool even with valid Run grants and a spoofed Resume label', async t => {
  const f = await firstPartyFixture(t), resume = await f.mcp.session('resume', signal)
  assert((await resume.list()).every(tool => tool.name.startsWith('resume.') || tool.name === 'artifact.build'))
  const foreign = await resume.call('resume.start', { requestId: randomUUID(), jobId: f.job.id, profileId: f.profile.id }, signal) as { runId: string }
  const authority = createMemoryAuthority(f.directory); f.cleanup(() => authority.close())
  const ask = external(f, await authority.issue('restricted-ask'), 'internal.resume')
  await ask.connect()
  assert.deepEqual((await ask.listTools()).map(t => t.name).sort(), [...askToolAllowlist].sort())
  const run = authority.registerRun('restricted-ask', randomUUID(), 'chat')
  const forbidden = [...jobAgentAllowlist.filter(name => name.startsWith('resume.')), 'artifact.build']
  for (const name of forbidden) {
    const args = { runId: foreign.runId }
    const result = await ask.callTool(name, args, signal, { jabRunGrant: run.grant(name, args) }) as { isError: boolean; content: { text: string }[] }
    assert.equal(result.isError, true, name); assert.equal(result.content[0].text, 'TOOL_FORBIDDEN', name)
  }
  assert.equal(f.backend.resumes.getRun({ id: foreign.runId }).run.state, 'REWRITING')
  assert.equal(f.outputs(), 0)
  assert(!f.backend.toolAudit.list().some(row => row.agent_id === 'internal.resume' && row.tool_name !== 'resume.start'))
  await run.close()
  await resume.call('resume.cancel', { runId: foreign.runId }, signal)
  assert.equal(f.backend.resumes.getRun({ id: foreign.runId }).run.state, 'CANCELLED')
})
