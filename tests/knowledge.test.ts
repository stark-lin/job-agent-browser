import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, symlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeFiles } from '../src/platform/knowledge/filesystem'
import { KnowledgeBackup } from '../src/platform/knowledge/git/backup'
import { KnowledgeIndex } from '../src/platform/knowledge/rag'
import { chunkMarkdown, approximateTokens } from '../src/platform/knowledge/rag/chunker'
import { knowledgePath } from '../src/domain/knowledge'
import { defaultKnowledgePreferences } from '../src/shared/knowledge-settings'
import { KnowledgeService } from '../src/platform/knowledge/service'
import { startKnowledgeBroker } from '../src/platform/knowledge/broker'
import { createBackend } from '../src/platform/database/backend'
import { createJobAgentTooling, jobAgentAllowlist } from '../src/platform/tools'
import { createPreferences } from '../src/platform/storage/preferences'
import { hash } from '../src/platform/knowledge/paths'
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'jab-knowledge-'))
  const disposers: (() => unknown | Promise<unknown>)[] = []
  t.after(async () => {
    try { for (const dispose of disposers.reverse()) await dispose() }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
  })
  const files = new KnowledgeFiles(directory)
  await files.initialize()
  return { directory, files, dispose: (fn: () => unknown | Promise<unknown>) => disposers.push(fn) }
}
const flatten = (node: Awaited<ReturnType<KnowledgeFiles['tree']>>): string[] => [
  node.path,
  ...(node.children ?? []).flatMap(flatten)
]
test('knowledge paths reject traversal, host paths, metadata and unsafe platform names', () => {
  for (const p of [
    '../x.md',
    'a/../x.md',
    '/etc/x.md',
    'C:\\x.md',
    '\\\\host\\x.md',
    '.git/config',
    'a//b.md',
    'a/.git/config',
    'a/CON.md',
    'a/x.',
    'a\u0000.md'
  ])
    assert.throws(() => knowledgePath(p))
  assert.equal(knowledgePath('面试/携程/README.md'), '面试/携程/README.md')
})
test('file service atomically saves, rejects stale multi-process writes and never overwrites on create or move', async (t) => {
  const { files, directory } = await fixture(t),
    first = await files.write('one.md', 'one', null),
    other = new KnowledgeFiles(directory)
  await assert.rejects(files.write('one.md', 'overwrite', null))
  assert.equal((await files.read('one.md')).content, 'one')
  const results = await Promise.allSettled([
    files.write('one.md', 'two', first.revision),
    other.write('one.md', 'three', first.revision)
  ])
  assert.equal(results.filter((v) => v.status === 'fulfilled').length, 1)
  assert.equal(results.filter((v) => v.status === 'rejected').length, 1)
  await files.write('target.md', 'keep', null)
  await assert.rejects(files.move('one.md', 'target.md', (await files.read('one.md')).revision))
  assert.equal((await files.read('target.md')).content, 'keep')
  await assert.rejects(files.write('one.md', 'x'.repeat(600000), (await files.read('one.md')).revision))
  assert.notEqual((await files.read('one.md')).content, '')
  const current = await files.read('one.md')
  await files.move('one.md', 'renamed.md', current.revision)
  assert.equal((await files.read('renamed.md')).content, current.content)
})
test('symlinks cannot be followed and directories containing unmanaged files cannot be moved or deleted', async (t) => {
  const { files, directory } = await fixture(t)
  await mkdir(join(directory, 'outside'))
  await writeFile(join(directory, 'outside', 'secret.md'), 'PRIVATE')
  await symlink(join(directory, 'outside'), join(files.root, 'link'))
  await assert.rejects(files.read('link/secret.md'))
  await assert.rejects(files.write('link/new.md', 'bad', null))
  assert(!flatten(await files.tree()).includes('link'))
  const folder = await files.mkdir('folder')
  await writeFile(join(files.root, 'folder', 'other.txt'), 'preserve')
  await assert.rejects(files.delete('folder', (await files.node('folder')).revision, true))
  await assert.rejects(files.move('folder', 'moved', folder.revision))
  assert.equal(await readFile(join(files.root, 'folder', 'other.txt'), 'utf8'), 'preserve')
})
test('README initialization is non-destructive, root bodies can be deleted, directory bodies remain explicit', async (t) => {
  const { files } = await fixture(t),
    root = await files.read('README.md')
  await files.delete('README.md', root.revision, false)
  await files.initialize()
  await assert.rejects(files.read('README.md'))
  await files.mkdir('interview')
  assert.equal((await files.node('interview')).readme, undefined)
  await files.write('interview/README.md', '# Context', null)
  assert.equal((await files.node('interview')).readme, 'interview/README.md')
})
test('AST chunking handles repeated headings, Unicode, code, tables, no heading and overlong lines within budget', async () => {
  const content =
    '# 携程\n\n## 洞察\n\n第一段\n\n## 洞察\n\n第二段\n\n```ts\n# not a heading\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n'
  const chunks = await chunkMarkdown('interview/ctrip.md', content)
  assert.equal(new Set(chunks.map((c) => c.id)).size, chunks.length)
  assert(chunks.some((c) => c.headingPath.includes('洞察')))
  assert(!chunks.some((c) => c.headingPath.includes('not a heading')))
  assert.deepEqual(await chunkMarkdown('empty.md', ''), [])
  assert((await chunkMarkdown('plain.md', 'plain text')).length === 1)
  const large = await chunkMarkdown('large.md', '# 大\n' + '中文'.repeat(4000))
  assert(large.length > 1)
  assert(large.every((c) => approximateTokens(c.content) <= 1000))
  assert(large.every((c) => c.startLine <= c.endLine))
  const updated = await chunkMarkdown('interview/ctrip.md', content.replace('第一段', '修改段'))
  assert.equal(updated[1].id, chunks[1].id)
  assert.notEqual(updated[1].contentHash, chunks[1].contentHash)
})
test('independent index retrieves Chinese short queries with citations, expands README and removes renamed/deleted sources', async (t) => {
  const { files, dispose } = await fixture(t),
    index = new KnowledgeIndex(files)
  dispose(() => index.close())
  await files.mkdir('interview')
  await files.mkdir('interview/ctrip')
  await files.write('interview/README.md', '面试准备总览', null)
  await files.write('interview/ctrip/README.md', '公司背景', null)
  const f = await files.write('interview/ctrip/pricing.md', '# Pricing\n\n携程的定价策略\n\n## Next\n\n用户洞察', null)
  await index.reconcile()
  const search = await index.search('携程')
  assert(search.items.some((h) => h.path === f.path))
  assert(search.items.every((h) => h.startLine >= 1))
  assert.equal(search.semantic, false)
  const context = await index.retrieve('定价', 1000)
  assert(context.sources.some((s) => s.path === 'interview/ctrip/README.md'))
  assert(context.text.includes('pricing.md:'))
  assert(approximateTokens((await index.retrieve('定价', 100)).text) < 150)
  await files.move(f.path, 'interview/ctrip/cost.md', f.revision)
  await index.reconcile()
  assert((await index.search('定价')).items.every((h) => h.path !== f.path))
  const renamed = await files.read('interview/ctrip/cost.md')
  await files.delete(renamed.path, renamed.revision, false)
  await index.reconcile()
  assert.equal((await index.search('定价')).items.length, 0)
})
test('unchanged indexing reuses vectors, updates invalidate old vectors and deleting the cache does not delete notes', async (t) => {
  const { files, directory } = await fixture(t)
  let calls = 0
  const provider = {
    identity: () => 'test/model',
    async embed(texts: string[]) {
      calls += texts.length
      return texts.map(() => [1, 0, 0])
    }
  }
  let index = new KnowledgeIndex(files, provider)
  const file = await files.write('vector.md', '# Vector\n\nunique payload', null)
  await index.reconcile()
  await index.indexEmbeddings()
  const first = calls
  await index.reconcile()
  await index.indexEmbeddings()
  assert.equal(calls, first)
  assert.equal((await index.search('irrelevant', 10, { identity: 'test/model', values: [1, 0, 0] })).semantic, true)
  await files.write(file.path, '# Vector\n\nchanged payload', file.revision)
  await index.reconcile()
  assert(
    (await index.search('irrelevant', 10, { identity: 'test/model', values: [1, 0, 0] })).items.every(
      (hit) => hit.path !== file.path
    )
  )
  await index.close()
  await rm(join(directory, 'knowledge-index.sqlite'))
  index = new KnowledgeIndex(files)
  await index.reconcile()
  assert.equal((await files.read(file.path)).content, '# Vector\n\nchanged payload')
  assert((await index.search('changed')).items.length)
  await index.close()
})
test('local history snapshots deletions, restores as a new version, and preserves pre-restore recovery', async (t) => {
  const { files } = await fixture(t),
    backup = new KnowledgeBackup(files, () => defaultKnowledgePreferences)
  const note = await files.write('note.md', 'original', null),
    initial = await backup.backup('Original')
  await files.write('note.md', 'changed', note.revision)
  await files.write('extra.md', 'extra', null)
  await backup.restore(initial, (await files.tree()).revision)
  assert.equal((await files.read('note.md')).content, 'original')
  await assert.rejects(files.read('extra.md'))
  const history = await backup.history()
  assert(history.some((v) => v.reason === 'Before restore'))
  assert(history[0].reason.startsWith('Restore '))
  assert(history[0].files.includes('extra.md'))
  const before = history.find((v) => v.reason === 'Before restore')!
  await backup.restore(before.commit, (await files.tree()).revision)
  assert.equal((await files.read('extra.md')).content, 'extra')
  const changed = await files.read('note.md')
  await files.delete('note.md', changed.revision, false)
  await backup.backup('Deletion')
  assert((await backup.history())[0].files.includes('note.md'))
})
test('restore rejects stale tree revisions and unmanaged collisions before modifying files', async (t) => {
  const { files } = await fixture(t),
    backup = new KnowledgeBackup(files, () => defaultKnowledgePreferences),
    f = await files.write('safe.md', 'before', null),
    commit = await backup.backup()
  const old = (await files.tree()).revision
  await files.write('safe.md', 'after', f.revision)
  await assert.rejects(backup.restore(commit, old))
  assert.equal((await files.read('safe.md')).content, 'after')
})
test('interrupted restore recovery accepts old/target versions but fences unexpected external changes', async (t) => {
  const { files, directory } = await fixture(t),
    backup = new KnowledgeBackup(files, () => defaultKnowledgePreferences)
  await files.write('safe.md', 'old', null)
  const commit = await backup.backup()
  await mkdir(join(directory, 'knowledge-runtime'), { recursive: true })
  await writeFile(
    join(directory, 'knowledge-runtime', 'restore.json'),
    JSON.stringify({
      commit,
      before: { 'README.md': '# Knowledge\n', 'safe.md': 'old' },
      after: { 'README.md': '# Knowledge\n', 'safe.md': 'new' }
    })
  )
  await assert.rejects(files.write('other.md', 'blocked', null))
  await backup.recover()
  assert.equal((await files.read('safe.md')).content, 'new')
  await writeFile(
    join(directory, 'knowledge-runtime', 'restore.json'),
    JSON.stringify({ commit, before: { 'safe.md': 'old' }, after: { 'safe.md': 'desired' } })
  )
  await assert.rejects(backup.recover())
  assert.equal((await files.read('safe.md')).content, 'new')
})
test('watcher observes external atomic changes, updates search and releases resources', async (t) => {
  const { directory, files, dispose } = await fixture(t),
    service = new KnowledgeService(directory, { preferences: () => defaultKnowledgePreferences, watch: true })
  await service.ready
  dispose(() => service.close())
  let changes = 0
  service.onChanged(() => changes++)
  await new Promise((r) => setTimeout(r, 100))
  await writeFile(join(files.root, 'outside.md'), '外部更新')
  const until = Date.now() + 4000
  while (changes === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 30))
  assert(changes > 0)
  assert((await service.search('更新')).items.some((h) => h.path === 'outside.md'))
})
test('MCP knowledge contracts share files, carry revisions and keep paths/content out of capability audit', async (t) => {
  const { directory, files, dispose } = await fixture(t),
    backend = createBackend(join(directory, 'database.sqlite')),
    service = new KnowledgeService(directory, { preferences: () => defaultKnowledgePreferences }),
    tools = createJobAgentTooling(backend, async () => ({}), service)
  dispose(async () => {
    tools.dispose()
    await backend.capabilities.dispose()
    await service.close()
    backend.close()
  })
  const scope = tools.registry.scope(
    { allow: jobAgentAllowlist, maxRisk: 'WRITE' },
    { agentId: 'test.knowledge', signal: new AbortController().signal }
  )
  dispose(() => scope.dispose())
  const output = await scope.execute('knowledge.write', {
    path: 'PRIVATE_PATH.md',
    content: 'PRIVATE_BODY',
    expectedRevision: null
  })
  assert(output.structuredContent)
  assert.equal((await files.read('PRIVATE_PATH.md')).content, 'PRIVATE_BODY')
  const list = await scope.execute('knowledge.list', { path: '' })
  assert(JSON.stringify(list).includes('PRIVATE_PATH.md'))
  await assert.rejects(
    scope.execute('knowledge.write', { path: 'PRIVATE_PATH.md', content: 'stale', expectedRevision: hash('other') })
  )
  const audit = JSON.stringify(backend.toolAudit.list())
  assert(audit.includes('knowledge.write'))
  assert(!audit.includes('PRIVATE_PATH'))
  assert(!audit.includes('PRIVATE_BODY'))
  assert(backend.toolAudit.list().some((row) => row.target_type === 'knowledge'))
})
test('knowledge preferences preserve old settings and validate remote/semantic disclosure prerequisites', async (t) => {
  const { directory } = await fixture(t),
    prefs = createPreferences(join(directory, 'settings.json'))
  const old = prefs.get({})
  assert.equal(old.knowledge, undefined)
  const next = prefs.savePreferences({ knowledge: defaultKnowledgePreferences })
  assert.equal(next.knowledge?.mode, 'split')
  prefs.savePreferences({ theme: 'dark' })
  assert.equal(prefs.get({}).knowledge?.mode, 'split')
  assert.throws(() =>
    prefs.savePreferences({ knowledge: { ...defaultKnowledgePreferences, remote: 'https://secret@github.com/a/b' } })
  )
  assert.equal(prefs.savePreferences({ knowledge: { ...defaultKnowledgePreferences, semanticEnabled: true } }).knowledge?.semanticEnabled, true)
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ ...prefs.get({}), knowledge: { ...defaultKnowledgePreferences, semanticEnabled: false, providerId: 'old', modelId: 'old' } }))
  assert.equal(prefs.get({}).knowledge?.semanticEnabled, false)
  assert.equal(prefs.get({}).theme, 'dark')
  assert(!('providerId' in prefs.get({}).knowledge!))
  assert.throws(() => prefs.savePreferences({ knowledge: { ...defaultKnowledgePreferences, providerId: 'old' } }))
})
test('embedding broker requires authentication and delegates query purpose', async (t) => {
  const { directory, files, dispose } = await fixture(t)
  const provider = { identity: () => 'fixture', embed: async (_texts: string[], purpose: string) => {
    assert.equal(purpose, 'query')
    return [[1, 0, 0]]
  } }
  const index = new KnowledgeIndex(files, provider)
  const stop = await startKnowledgeBroker(directory, index)
  dispose(async () => {
    await stop()
    await index.close()
  })
  const config = JSON.parse(await readFile(join(directory, 'knowledge-runtime', 'broker.json'), 'utf8')) as {
    port: number
    token: string
  }
  assert.equal((await fetch(`http://127.0.0.1:${config.port}/query`, { method: 'POST', body: '{}' })).status, 403)
  const response = await fetch(`http://127.0.0.1:${config.port}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ query: 'private' })
  })
  assert.equal(response.status, 200)
  assert(!JSON.stringify(await response.json()).includes(config.token))
})

test('corrupted derived cache can be rebuilt without resetting Markdown or business data', async (t) => {
  const { files, directory, dispose } = await fixture(t)
  await files.write('truth.md', 'canonical', null)
  await writeFile(join(directory, 'knowledge-index.sqlite'), 'broken database')
  const index = new KnowledgeIndex(files)
  dispose(() => index.close())
  await assert.rejects(index.reconcile())
  await index.rebuild()
  assert.equal((await files.read('truth.md')).content, 'canonical')
  assert((await index.search('canonical')).items.length)
})
test('Git metadata symlinks cannot make backup write outside the knowledge repository', async (t) => {
  const { files, directory } = await fixture(t),
    backup = new KnowledgeBackup(files, () => defaultKnowledgePreferences)
  await backup.backup()
  const external = join(directory, 'protected.md')
  await writeFile(external, 'protected')
  await rm(join(files.root, '.git', 'config'))
  await symlink(external, join(files.root, '.git', 'config'))
  await assert.rejects(backup.backup())
  assert.equal(await readFile(external, 'utf8'), 'protected')
})
