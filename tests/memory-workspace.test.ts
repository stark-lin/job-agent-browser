import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'node:fs'
import git from 'isomorphic-git'
import { SmartNoteWorkspace } from '../src/platform/knowledge/workspace'
import { createWorkspaceStorage, type MigrationStep } from '../src/platform/knowledge/workspace-storage'
import { KnowledgeFiles } from '../src/platform/knowledge/filesystem'
import { KnowledgeBackup } from '../src/platform/knowledge/git/backup'
import { defaultKnowledgePreferences } from '../src/shared/knowledge-settings'
import { hash } from '../src/platform/knowledge/paths'
const preferences = () => defaultKnowledgePreferences
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'jab-memory-'))
  const disposers: (() => Promise<unknown>)[] = []
  t.after(async () => { for (const close of disposers.reverse()) await close(); await rm(directory, { recursive: true, force: true }) })
  const workspace = (owner = true) => { const w = new SmartNoteWorkspace(directory, { preferences }, owner); disposers.push(() => w.close()); return w }
  return { directory, workspace }
}
test('fresh workspace shares one Git repository and isolates same-path retrieval, revisions, history and restore', async t => {
  const f = await fixture(t), w = f.workspace(); await w.ready
  const k = w.spaces.knowledge, m = w.spaces.memory
  const a = await k.files.write('same.md', '# Knowledge\ncommon avocado', null)
  const b = await m.files.write('same.md', '# Memory\ncommon pineapple', null)
  const before = await w.backup.backup('Both spaces')
  await k.files.write('same.md', 'updated avocado', a.revision)
  await w.backup.backup('Knowledge only')
  assert(!(await m.backup.history()).some(v => v.reason === 'Knowledge only'))
  assert((await k.backup.history()).some(v => v.reason === 'Knowledge only'))
  assert.deepEqual((await m.backup.history(0, 1)).map(v => v.reason), ['Both spaces'])
  assert((await k.search('avocado')).items.some(h => h.path === 'same.md'))
  assert.equal((await k.search('pineapple')).items.length, 0)
  assert((await m.search('pineapple')).items.every(h => h.path === 'same.md'))
  assert.equal((await m.search('avocado')).items.length, 0)
  assert(!(await m.retrieve('pineapple')).text.includes('avocado'))
  await m.files.write('same.md', 'new memory pineapple', b.revision)
  await k.backup.restore(before, (await k.files.tree()).revision)
  assert.equal((await k.files.read('same.md')).content, a.content)
  assert.equal((await m.files.read('same.md')).content, 'new memory pineapple')
  await m.backup.restore(before, (await m.files.tree()).revision)
  assert.equal((await m.files.read('same.md')).content, b.content)
  await assert.rejects(m.files.write('../knowledge/same.md', 'bad', null))
  await assert.rejects(m.files.delete('', (await m.files.tree()).revision, true))
  await assert.rejects(m.files.move('', 'gone', (await m.files.tree()).revision))
  const stale = await m.files.read('same.md')
  const races = await Promise.allSettled([m.files.write('same.md', 'one', stale.revision), m.files.write('same.md', 'two', stale.revision)])
  assert.equal(races.filter(r => r.status === 'fulfilled').length, 1)
  const external = f.workspace(false); await external.ready
  assert.equal((await external.spaces.memory.files.read('same.md')).content, (await m.files.read('same.md')).content)
  for (const space of ['knowledge', 'memory']) assert((await lstat(join(f.directory, `${space}-index.sqlite`))).isFile())
  await assert.rejects(lstat(join(w.storage.root, 'memory', '.git')))
})
test('legacy migration retains dirty and untracked bytes, old nested space names, and explicit legacy history', async t => {
  const f = await fixture(t), files = new KnowledgeFiles(f.directory); await files.initialize()
  await files.mkdir('knowledge'); await files.mkdir('memory')
  await files.write('knowledge/nested.md', 'old knowledge directory', null)
  await files.write('memory/nested.md', 'old memory directory', null)
  const note = await files.write('note.md', 'committed', null)
  const backup = new KnowledgeBackup(files, preferences), old = await backup.backup('Legacy version')
  await files.write('note.md', 'dirty content', note.revision)
  await writeFile(join(files.root, 'untracked.bin'), Buffer.from([0, 255, 4]))
  await writeFile(join(files.root, 'untracked.md'), '# Untracked')
  const w = f.workspace(); await w.ready
  assert.equal((await w.files.read('note.md')).content, 'dirty content')
  assert.equal((await w.files.read('memory/nested.md')).content, 'old memory directory')
  assert.equal((await w.files.read('knowledge/nested.md')).content, 'old knowledge directory')
  assert.deepEqual(await readFile(join(w.files.root, 'untracked.bin')), Buffer.from([0, 255, 4]))
  assert.deepEqual(await w.spaces.memory.backup.versionFiles(old), {})
  assert.equal((await w.backup.versionFiles(old))['note.md'], 'committed')
  await assert.rejects(files.write('old-version.md', 'unsafe', null))
  await w.spaces.memory.files.write('private.md', 'memory survives', null)
  await w.backup.restore(old, (await w.files.tree()).revision)
  assert.equal((await w.files.read('note.md')).content, 'committed')
  assert.equal((await w.spaces.memory.files.read('private.md')).content, 'memory survives')
  assert.equal((await git.readCommit({ fs, dir: w.storage.root, oid: old })).commit.message.trim(), 'Legacy version')
  assert((await lstat(join(f.directory, 'knowledge'))).isFile())
  assert((await lstat(join(f.directory, 'knowledge-archive-v1'))).isDirectory())
})
for (const step of ['copy', 'staged', 'prepared', 'archived', 'published', 'marked'] as MigrationStep[]) test(`migration resumes after interruption at ${step} and independent MCP refuses unfinished layouts`, async t => {
  const f = await fixture(t), files = new KnowledgeFiles(f.directory); await files.initialize()
  await files.write('keep.md', 'preserve me', null)
  const storage = createWorkspaceStorage(f.directory, true, phase => { if (phase === step) throw new Error('power loss') })
  await assert.rejects(storage.ready)
  await assert.rejects(createWorkspaceStorage(f.directory, false).ready)
  const w = f.workspace(); await w.ready
  assert.equal((await w.files.read('keep.md')).content, 'preserve me')
  const repeat = createWorkspaceStorage(f.directory, true); await repeat.ready
  assert.equal(repeat.layout.migrationCommit, w.storage.layout.migrationCommit)
})
test('unsafe legacy paths stop migration without publishing an empty workspace or touching source bytes', async t => {
  const f = await fixture(t), files = new KnowledgeFiles(f.directory); await files.initialize()
  await files.write('keep.md', 'original', null)
  await symlink('/tmp', join(files.root, 'link'))
  await assert.rejects(createWorkspaceStorage(f.directory, true).ready)
  assert.equal(await readFile(join(files.root, 'keep.md'), 'utf8'), 'original')
  await assert.rejects(lstat(join(f.directory, 'smart-note')))
})
test('old restore journal is completed before migration; per-space journal recovery preserves the other space', async t => {
  const f = await fixture(t), files = new KnowledgeFiles(f.directory); await files.initialize()
  await files.write('old.md', 'before', null)
  await mkdir(join(f.directory, 'knowledge-runtime'))
  await writeFile(join(f.directory, 'knowledge-runtime/restore.json'), JSON.stringify({ commit: 'a'.repeat(40), before: { 'old.md': 'before' }, after: { 'old.md': 'after' } }))
  const w = f.workspace(); await w.ready
  assert.equal((await w.files.read('old.md')).content, 'after')
  await w.spaces.memory.files.write('old.md', 'Memory before', null)
  await writeFile(join(w.storage.runtime, 'restore.json'), JSON.stringify({ space: 'memory', commit: 'b'.repeat(40), before: { 'old.md': 'Memory before' }, after: { 'old.md': 'Memory after' } }))
  await assert.rejects(w.files.write('blocked.md', 'blocked', null))
  await w.backup.recover()
  assert.equal((await w.spaces.memory.files.read('old.md')).content, 'Memory after')
  assert.equal((await w.files.read('old.md')).content, 'after')
})
test('shared provider serializes both spaces and rebuilding one index neither cancels nor disposes it', async t => {
  const f = await fixture(t); let active = 0, peak = 0, disposed = 0, cancelled = 0
  const w = new SmartNoteWorkspace(f.directory, { preferences, embeddings: {
    identity: () => 'fixture', cancel: () => { cancelled++ }, dispose: async () => { disposed++ },
    embed: async texts => { peak = Math.max(peak, ++active); await new Promise(r => setTimeout(r, 5)); active--; return texts.map(() => [1, 0]) }
  } })
  await w.ready
  await w.files.write('shared.md', 'knowledge vector', null); await w.spaces.memory.files.write('shared.md', 'memory vector', null)
  await Promise.all(Object.values(w.spaces).map(async s => { await s.index.reconcile(); await s.index.indexEmbeddings() }))
  assert.equal(peak, 1)
  assert((await w.spaces.memory.search('memory')).semantic)
  assert((await w.call('rebuild', { space: 'knowledge' })).ok)
  assert.equal(cancelled, 0); assert.equal(disposed, 0)
  assert((await w.spaces.memory.search('memory')).semantic)
  await w.close(); await w.close(); assert.equal(disposed, 1)
})
test('sync consent is scoped to the normalized remote, persisted by Main, and cleared when remote changes', async t => {
  const f = await fixture(t)
  let prefs = { ...defaultKnowledgePreferences, remote: 'https://github.com/example/notes.git' }
  const w = new SmartNoteWorkspace(f.directory, { preferences: () => prefs, configure: value => (prefs = value as typeof prefs) })
  await w.ready
  assert.deepEqual(await w.call('syncConsent', {}), { ok: true, value: { remote: prefs.remote, required: true } })
  const blocked = await w.call('sync', {}); assert(blocked.ok); assert.equal(blocked.value.error, 'SYNC_CONSENT_REQUIRED')
  assert.equal((await w.call('approveSync', { remote: 'https://github.com/else/repo' })).ok, false)
  assert((await w.call('approveSync', { remote: prefs.remote })).ok)
  assert((await readFile(join(w.storage.runtime, 'consent.json'), 'utf8')).includes('https://github.com/example/notes'))
  assert((await w.call('configure', { ...prefs, remote: 'https://github.com/example/notes' })).ok)
  const equivalent = await w.call('syncConsent', {}); assert(equivalent.ok); assert.equal(equivalent.value.required, false)
  assert((await w.call('configure', { ...prefs, remote: 'https://github.com/example/other' })).ok)
  const changed = await w.call('syncConsent', {}); assert(changed.ok); assert(changed.value.required)
  await w.close()
  const noProvider = f.workspace(); await noProvider.ready
  assert.equal((await noProvider.spaces.memory.search('absent')).semantic, false)
  assert.equal(hash('fixture').length, 64)
})

test('runtime root replacement and missing Git metadata fail closed without reinitializing an empty repository', async t => {
  const f = await fixture(t), w = f.workspace(); await w.ready
  await rm(join(w.storage.root, '.git'), { recursive: true })
  await assert.rejects(w.backup.backup())
  await assert.rejects(lstat(join(w.storage.root, '.git')))
  await rm(w.storage.root, { recursive: true })
  const outside = join(f.directory, 'outside'); await mkdir(outside); await mkdir(join(outside, 'memory'))
  await writeFile(join(outside, 'memory/private.md'), 'outside content')
  await symlink(outside, w.storage.root)
  await assert.rejects(w.spaces.memory.files.read('private.md'))
})

test('concurrent storage initializers publish one generation and a prepared migration refuses changed source bytes', async t => {
  const f = await fixture(t)
  const [one, two] = [createWorkspaceStorage(f.directory, true), createWorkspaceStorage(f.directory, true)]
  await Promise.all([one.ready, two.ready]); assert.equal(one.layout.migrationCommit, two.layout.migrationCommit)
  const other = await fixture(t), files = new KnowledgeFiles(other.directory); await files.initialize()
  await files.write('keep.md', 'source snapshot', null)
  await assert.rejects(createWorkspaceStorage(other.directory, true, step => { if (step === 'prepared') throw new Error('pause') }).ready)
  await writeFile(join(files.root, 'keep.md'), 'external change after snapshot')
  await assert.rejects(createWorkspaceStorage(other.directory, true).ready)
  assert.equal(await readFile(join(files.root, 'keep.md'), 'utf8'), 'external change after snapshot')
  await assert.rejects(lstat(join(other.directory, 'smart-note')))
})
test('general Settings remote changes clear old consent even when returning to the original remote before restart', async t => {
  const f = await fixture(t)
  let prefs = { ...defaultKnowledgePreferences, remote: 'https://github.com/example/original.git' }
  const w = new SmartNoteWorkspace(f.directory, { preferences: () => prefs }); await w.ready
  assert((await w.call('approveSync', { remote: prefs.remote })).ok)
  prefs = { ...prefs, remote: 'https://github.com/example/other.git' }; w.remoteChanged(prefs.remote)
  prefs = { ...prefs, remote: 'https://github.com/example/original.git' }; w.remoteChanged(prefs.remote)
  const current = await w.call('syncConsent', {}); assert(current.ok); assert(current.value.required)
  await w.close()
  const next = new SmartNoteWorkspace(f.directory, { preferences: () => prefs }); await next.ready
  const restarted = await next.call('syncConsent', {}); assert(restarted.ok); assert(restarted.value.required)
  await next.close()
})
