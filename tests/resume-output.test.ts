import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, symlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { LegacyTransactions as Transactions } from './legacy-migration-fixture'
import { Store } from '../src/platform/database/repositories/store'
import { migrate, migrations } from '../src/platform/database/migrations'
import { composeBackend } from '../src/platform/database/backend'
import { createResumeOutput } from '../src/platform/resume-output/service'
import { randomUUID } from 'node:crypto'
import { compileHTML, safeLink } from '../src/platform/resume-output/compiler'
import { artifactFiles } from '../src/platform/resume-output/files'
import { published } from './helpers'

test('HTML compiler is deterministic, escaped, local-only and rejects dangerous link protocols', async t => {
  const f = await published(t), document = structuredClone(f.content)
  document.basics.name = '<img src=x onerror=alert(1)> & "name"'
  document.experience[0].bullets[0].text = '<script>alert(1)</script>'
  document.basics.links = [{ label: '<script>', url: 'javascript:alert(1)' }]
  const template = { id: 'default-v1' as const, fontVersion: 'noto-sc-v1' as const, fontBase64: 'AAAA' }
  const html = compileHTML(document, template)
  assert.equal(html, compileHTML(structuredClone(document), template))
  assert(!html.includes('<script>')); assert(!html.includes('<img')); assert(!html.includes('href="javascript:'))
  assert(html.includes('javascript:alert(1)'))
  assert(html.includes('&lt;script&gt;')); assert(html.includes("script-src 'none'")); assert(html.includes('font-src data:'))
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'file:///etc/passwd', 'https://user:secret@example.com']) assert.equal(safeLink(url), null)
  assert.equal(safeLink('https://example.com/a'), 'https://example.com/a')
})
test('managed file output is atomic, constrained to artifact root, symlink-safe and cancelled before replacement', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'resume-output-')); t.after(() => rmSync(directory, { recursive: true, force: true }))
  const root = join(directory, 'artifacts'), store = artifactFiles(root), id = randomUUID(), signal = new AbortController().signal
  const files = await store.write(id, { html: 'safe html', pdf: Buffer.from('safe pdf') }, signal)
  assert.deepEqual(files.map(file => file.format), ['HTML', 'PDF'])
  assert.equal((await store.read(files[0].relativePath)).toString(), 'safe html')
  for (const path of ['../outside.pdf', '/tmp/x.pdf', 'a/../../x', 'a//x', 'a/./x']) await assert.rejects(store.read(path), /INVALID_OUTPUT_PATH/)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(store.write(id, { html: 'replace', pdf: Buffer.from('replace') }, cancelled.signal))
  assert.equal((await readFile(join(root, files[0].relativePath))).toString(), 'safe html')
  const other = randomUUID(); await mkdir(join(directory, 'outside')); await symlink(join(directory, 'outside'), join(root, other))
  await assert.rejects(store.write(other, { html: 'escape', pdf: Buffer.from('escape') }, signal), /INVALID_OUTPUT_PATH/)
})

test('version 18 resume history, managed PDF and provenance survive the upgrade', async t => {
  const f = await published(t), db = new DatabaseSync(':memory:'), transactions = new Transactions(db)
  const root = mkdtempSync(join(tmpdir(), 'resume-upgrade-'))
  t.after(() => { if (db.isOpen) db.close(); rmSync(root, { recursive: true, force: true }) })
  migrate(db, migrations.slice(0, 18))
  const store = new Store(db)
  const pdf = Buffer.from('%PDF-1.4 fixture from the old version')
  const files = await artifactFiles(root).write(f.artifact.id, { html: 'Historical preview', pdf }, new AbortController().signal)
  const artifact = f.artifact
  const { agentRunId: _agent, state: _state, stateVersion: _stateVersion, ...run } = f.run
  const legacy = { ...run, language: 'en', status: 'SUCCEEDED', stage: 'output' }
  const unfinishedId = randomUUID()
  transactions.write(() => {
    store.insert('job', f.job)
    store.insert('profile', f.profile)
    store.insert('profile_item', f.item)
    store.insert('fact', f.fact)
    store.insert('generation_run', legacy)
    db.prepare('UPDATE generation_runs SET polished_json=? WHERE id=?').run(JSON.stringify(f.content), run.id)
    store.insert('generation_run', { ...legacy, id: unfinishedId, status: 'RUNNING', stage: 'optimize' })
    store.insert('artifact', { ...artifact, outputFiles: files, output: { status: 'READY', error: null, pages: 1 } })
    store.insert('artifact_fact', { artifactId: artifact.id, blockId: f.provenance[0].blockId, factId: f.fact.id })
  })
  migrate(db)
  const backend = composeBackend({ connection: db, transactions, close: () => db.close() })
  try {
    const view = backend.resumes.getArtifact({ id: artifact.id })
    assert.equal(view.artifact.revision, 1)
    assert.deepEqual(view.artifact.content, artifact.content)
    assert.deepEqual(view.provenance, f.provenance)
    assert.equal(backend.resumes.getRun({ id: run.id }).run.state, 'PUBLISHED')
    assert.deepEqual(JSON.parse(String(db.prepare('SELECT legacy_payload_json FROM generation_runs WHERE id=?').get(run.id)?.legacy_payload_json)).polished, f.content)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(backend.resumes.getRun({ id: unfinishedId }).run.state, 'INTERRUPTED')
    const output = createResumeOutput(backend, root, '', () => assert.fail('Historical PDF must not rebuild'))
    assert.deepEqual((await output.read(artifact.id, 'PDF')).bytes, pdf)
  } finally { backend.close() }
})

test('failed compilation preserves the edited revision and successful retry uses that content', async t => {
  const f = await published(t), root = mkdtempSync(join(tmpdir(), 'resume-recompile-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const next = { ...f.content, basics: { ...f.content.basics, name: 'Edited name', links: [{ label: 'Portfolio', url: 'example.com/my work' }] },
    experience: f.content.experience.map(entry => ({ ...entry, startDate: 'Summer 2020 (part-time)', endDate: '毕业后',
      url: 'github.com/example/project', title: '', organization: '', isCurrent: true })),
    summary: { id: randomUUID(), text: '手动填写的个人简介', factIds: [] },
    skills: [{ id: randomUUID(), text: 'Manual skill', factIds: [f.fact.id] }] }
  const edited = f.backend.resumes.editArtifact({ id: f.artifact.id, title: f.artifact.title, expectedRevision: 1, content: next })
  assert.deepEqual(edited.content.experience[0].bullets[0].factIds, [f.fact.id])
  assert.deepEqual(edited.content.skills[0].factIds, [])
  let fail = true
  const output = createResumeOutput(f.backend, root, '', async document => {
    if (fail) throw new Error('Fixture build failed')
    assert.deepEqual(document, edited.content)
    return { html: compileHTML(document, { id: 'default-v1', fontVersion: 'noto-sc-v1', fontBase64: 'AAAA' }), pdf: Buffer.from('PDF'), pages: 1 }
  })
  const signal = new AbortController().signal
  assert.equal((await output.build(f.artifact.id, signal)).output.status, 'FAILED')
  assert.deepEqual(f.backend.resumes.getArtifact({ id: f.artifact.id }).artifact.content, edited.content)
  fail = false
  assert.equal((await output.build(f.artifact.id, signal)).output.status, 'READY')
  const preview = await output.read(f.artifact.id, 'HTML')
  assert.equal(preview.revision, 2)
  const html = preview.bytes.toString()
  for (const text of ['Edited name', 'Summer 2020 (part-time)', 'example.com/my work', 'github.com/example/project', '手动填写的个人简介', 'Manual skill']) assert(html.includes(text))
})
