import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { symlink } from 'node:fs/promises'
import { firstPartyFixture } from './first-party-fixture'
import { createMCPClient } from '../src/platform/mcp/client'
import { createMemoryAuthority } from '../src/platform/mcp/memory-authority'
import { approximateTokens } from '../src/platform/knowledge/rag/chunker'
import { validateDescriptor } from '../src/shared/tools/policy'
const signal = new AbortController().signal
const names = ['memory.list', 'memory.recall', 'memory.read', 'memory.write', 'memory.mkdir']
function external(f: Awaited<ReturnType<typeof firstPartyFixture>>, launch?: string, caller = 'internal.ask-ai') {
  const client = createMCPClient({ id: 'spoofed', enabled: true, transport: 'stdio', command: process.execPath, args: [join(f.directory, 'job-agent-mcp.js')], tools: [] }, { changed() {}, closed() {} }, {
    processEnv: { JOB_BROWSER_USER_DATA: f.directory, JOB_BROWSER_MCP_CALLER: caller, ELECTRON_RUN_AS_NODE: '1', ...(launch === undefined ? {} : { JOB_BROWSER_MEMORY_LAUNCH: launch }) }
  })
  f.cleanup(() => client.close()); return client
}
test('only authenticated Ask AI sessions expose exactly five Memory tools; caller labels and hidden direct calls grant nothing', async t => {
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
  const f = await firstPartyFixture(t), ask = await f.mcp.session('ask-ai', signal)
  await ask.call('knowledge.write', { path: 'same.md', content: 'Knowledge SECRET_K', expectedRevision: null }, signal)
  const memory = await ask.call('memory.write', { path: 'same.md', content: '# Memory\nSECRET_M pineapple', expectedRevision: null }, signal) as { revision: string }
  assert.notEqual(memory.revision, '')
  const read = await ask.call('memory.read', { path: 'same.md' }, signal) as { content: string }
  assert(read.content.includes('SECRET_M')); assert(!read.content.includes('SECRET_K'))
  const recalled = await ask.call('memory.recall', { query: 'pineapple' }, signal) as { text: string }
  assert(recalled.text.includes('SECRET_M')); assert(!recalled.text.includes('SECRET_K'))
  await ask.call('memory.write', { path: 'budget.md', content: Array.from({ length: 12 }, (_, i) => `# Pineapple section ${i}\n\n${'pineapple context '.repeat(250)}\n\n`).join(''), expectedRevision: null }, signal)
  const budgeted = await ask.call('memory.recall', { query: 'pineapple context' }, signal) as { text: string; truncated: boolean }
  assert(approximateTokens(budgeted.text) <= 2000); assert(budgeted.truncated)
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
