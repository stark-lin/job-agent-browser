import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { externalMCPTargets, type ExternalMCPTarget } from '../src/shared/external-mcp'
import { externalSkillNames } from '../src/shared/external-skills'
import { createExternalSkillsInstaller, externalSkillsPath } from '../src/platform/skills/install'
import { skillTree } from '../src/platform/skills/tree'
import { createExternalSkillsBridge } from '../src/platform/electron/preload/external-skills-bridge'

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), 'external skills ')), home = join(root, 'home'), source = join(root, 'bundled skills')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const name of externalSkillNames) {
    fs.mkdirSync(join(source, name, 'references'), { recursive: true })
    fs.writeFileSync(join(source, name, 'SKILL.md'), `---\nname: ${name}\n---\n[中文](SKILL.zh-CN.md)\n`)
    fs.writeFileSync(join(source, name, 'SKILL.zh-CN.md'), '[English](SKILL.md)\n')
    fs.writeFileSync(join(source, name, 'references', 'guide.md'), 'Complete supporting resource')
  }
  let opened: string | undefined
  const service = createExternalSkillsInstaller({ home, bundleDirectory: source, async openPath(path) { opened = path; return '' } })
  const status = (target: ExternalMCPTarget = 'codex') => service.inspect({}).clients.find(client => client.target === target)!
  const install = (target: ExternalMCPTarget = 'codex', replace = false) => service.install({ target, revision: status(target).revision, replace })
  return { root, home, source, service, status, install, opened: () => opened }
}

for (const target of externalMCPTargets) {
  test(`${target}: reconnect reinstalls matching folders and selective deletion preserves other Skills`, t => {
    const f = fixture(t), installed = f.install(target), path = installed.status.path
    const before = skillTree(join(path, 'capture-job')).revision
    const reconnected = f.service.reconnect({ target, revision: installed.status.revision, replace: false })
    assert.equal(reconnected.operation, 'reconnect')
    assert.deepEqual(reconnected.completed, externalSkillNames)
    assert.notEqual(skillTree(join(path, 'capture-job')).revision, before)
    assert.equal(reconnected.error, undefined)
    fs.mkdirSync(join(path, 'unrelated')); fs.writeFileSync(join(path, 'unrelated', 'SKILL.md'), 'keep')
    const removed = f.service.remove({ target, revision: f.status(target).revision, names: ['capture-job'] })
    assert.equal(removed.operation, 'remove')
    assert.equal(removed.error, undefined)
    assert.deepEqual(removed.completed, ['capture-job'])
    assert.deepEqual(removed.pending, [])
    assert(!fs.existsSync(join(path, 'capture-job')))
    assert(fs.existsSync(join(path, 'manage-applications', 'SKILL.md')))
    assert.equal(fs.readFileSync(join(path, 'unrelated', 'SKILL.md'), 'utf8'), 'keep')
    assert.equal(f.service.remove({ target, revision: installed.status.revision, names: ['manage-applications'] }).error, 'SKILLS_CHANGED')
    const all = f.service.remove({ target, revision: f.status(target).revision, names: [...externalSkillNames] })
    assert.equal(all.error, undefined)
    assert(all.status.skills.every(skill => skill.state === 'missing'))
    const again = f.service.remove({ target, revision: all.status.revision, names: [...externalSkillNames] })
    assert.deepEqual(again.completed, [])
    assert.equal(again.error, undefined)
  })
}

test('deletion removes root links only, rejects stale confirmations and arbitrary names, and reports partial failures', t => {
  const f = fixture(t), installed = f.install(), path = installed.status.path
  fs.rmSync(join(path, 'capture-job'), { recursive: true })
  fs.symlinkSync(join(f.source, 'capture-job'), join(path, 'capture-job'), 'dir')
  const removed = f.service.remove({ target: 'codex', revision: f.status().revision, names: ['capture-job'] })
  assert.equal(removed.error, undefined)
  assert(fs.existsSync(join(f.source, 'capture-job', 'SKILL.md')))
  assert(!fs.existsSync(join(path, 'capture-job')))
  const request = { target: 'codex', revision: f.status().revision, names: ['manage-applications'] }
  for (const names of [[], ['../unrelated'], ['unrelated'], ['capture-job', 'capture-job'], [null]]) {
    assert.throws(() => f.service.remove({ ...request, names }), { code: 'INVALID_INPUT' })
  }
  assert.throws(() => f.service.remove({ ...request, path: '/arbitrary' }), { code: 'INVALID_INPUT' })
  fs.writeFileSync(join(path, 'manage-applications', 'SKILL.md'), 'local edit')
  assert.equal(f.service.remove(request).error, 'SKILLS_CHANGED')
  assert.equal(f.service.reconnect({ target: 'codex', revision: f.status().revision, replace: false }).error, 'REPLACE_REQUIRED')
  const remove = fs.rmSync
  t.mock.method(fs, 'rmSync', (...args: Parameters<typeof remove>) => {
    if (String(args[0]).endsWith('tailor-resume')) throw new Error('private path')
    return remove(...args)
  })
  const result = f.service.remove({ ...request, revision: f.status().revision, names: ['manage-applications', 'tailor-resume'] })
  assert.equal(result.error, 'REMOVE_FAILED')
  assert.deepEqual(result.completed, ['manage-applications'])
  assert.deepEqual(result.pending, ['tailor-resume'])
  assert(!JSON.stringify(result).includes('private path'))
})
for (const target of externalMCPTargets) {
  test(`${target}: complete standalone installation is idempotent and preserves other Skills`, t => {
    const f = fixture(t), path = externalSkillsPath(f.home, target)
    assert(f.status(target).skills.every(skill => skill.state === 'missing'))
    assert(!fs.existsSync(f.home), 'inspection must not create directories')
    fs.mkdirSync(join(path, 'unrelated'), { recursive: true })
    fs.writeFileSync(join(path, 'unrelated', 'SKILL.md'), 'retained')
    const result = f.install(target)
    assert.equal(result.error, undefined)
    assert.deepEqual(result.completed, externalSkillNames)
    assert.deepEqual(result.pending, [])
    for (const name of externalSkillNames) {
      assert.equal(skillTree(join(path, name)).content, skillTree(join(f.source, name), true).content)
      assert(!fs.lstatSync(join(path, name)).isSymbolicLink())
    }
    const before = f.status(target), treeBefore = skillTree(path)
    const again = f.install(target)
    assert.deepEqual(again.completed, [])
    assert.equal(again.error, undefined)
    assert.deepEqual(f.status(target), before)
    assert.equal(skillTree(path).revision, treeBefore.revision, 'repeat installation writes nothing')
    fs.rmSync(join(path, 'tailor-resume'), { recursive: true })
    const partial = f.install(target)
    assert.deepEqual(partial.completed, ['tailor-resume'])
    assert.equal(fs.readFileSync(join(path, 'unrelated', 'SKILL.md'), 'utf8'), 'retained')
    assert(!fs.readdirSync(path).some(name => name.startsWith('.job-agent-skills-') || name.endsWith('.bak')))
  })
}

test('different complete folders require confirmation; replacement saves no backups', t => {
  const f = fixture(t)
  f.install()
  const path = join(f.status().path, 'capture-job')
  fs.writeFileSync(join(path, 'SKILL.zh-CN.md'), 'custom Chinese content')
  fs.writeFileSync(join(path, 'extra.txt'), 'custom resource')
  const before = skillTree(f.status().path)
  const refused = f.install()
  assert.equal(refused.error, 'REPLACE_REQUIRED')
  assert.deepEqual(refused.completed, [])
  assert.equal(skillTree(f.status().path).revision, before.revision)
  const replaced = f.install('codex', true)
  assert.equal(replaced.error, undefined)
  assert.deepEqual(replaced.completed, ['capture-job'])
  assert(!fs.existsSync(join(path, 'extra.txt')))
  assert.deepEqual(fs.readdirSync(f.status().path).sort(), [...externalSkillNames].sort())
})

test('canonical bilingual Skills install from a detached bundle after its original copy is removed', t => {
  const f = fixture(t), detached = join(f.root, 'detached distribution', 'skills')
  fs.rmSync(f.source, { recursive: true })
  fs.cpSync(resolve('skills'), f.source, { recursive: true })
  fs.cpSync(f.source, detached, { recursive: true })
  fs.rmSync(f.source, { recursive: true })
  const service = createExternalSkillsInstaller({ home: f.home, bundleDirectory: detached, async openPath() { return '' } })
  for (const target of externalMCPTargets) {
    const status = service.inspect({}).clients.find(client => client.target === target)!
    const result = service.install({ target: status.target, revision: status.revision, replace: false })
    assert.equal(result.error, undefined)
    assert(result.status.skills.every(skill => skill.state === 'installed'))
    for (const name of externalSkillNames) for (const file of ['SKILL.md', 'SKILL.zh-CN.md']) {
      assert.equal(fs.readFileSync(join(status.path, name, file), 'utf8'), fs.readFileSync(join(detached, name, file), 'utf8'))
    }
  }
})

test('confirmation rejects changed content, replaced files and redirected parent directories', t => {
  const f = fixture(t)
  f.install()
  const path = f.status().path, stale = f.status()
  fs.writeFileSync(join(path, 'capture-job', 'references', 'guide.md'), 'changed during confirmation')
  assert.equal(f.service.install({ target: 'codex', revision: stale.revision, replace: true }).error, 'SKILLS_CHANGED')
  const before = f.status()
  const file = join(path, 'tailor-resume', 'SKILL.md'), body = fs.readFileSync(file)
  fs.unlinkSync(file); fs.writeFileSync(file, body)
  assert.equal(f.service.install({ target: 'codex', revision: before.revision, replace: true }).error, 'SKILLS_CHANGED')
  const current = f.status(), redirected = join(f.root, 'redirected')
  fs.renameSync(path, redirected); fs.symlinkSync(redirected, path, 'dir')
  assert.equal(f.service.install({ target: 'codex', revision: current.revision, replace: true }).error, 'SKILLS_CHANGED')
})

test('matching symlinks need no rewrite; differing and dangling links replace only the link', t => {
  const f = fixture(t), path = f.status().path, external = join(f.root, 'outside Skill')
  fs.mkdirSync(path, { recursive: true }); fs.mkdirSync(external)
  fs.writeFileSync(join(external, 'SKILL.md'), 'outside content')
  fs.symlinkSync(join(f.source, 'capture-job'), join(path, 'capture-job'), 'dir')
  fs.symlinkSync(external, join(path, 'manage-applications'), 'dir')
  fs.symlinkSync(join(f.root, 'absent'), join(path, 'tailor-resume'), 'dir')
  assert.equal(f.status().skills[0].state, 'installed')
  assert.equal(f.install().error, 'REPLACE_REQUIRED')
  const result = f.install('codex', true)
  assert.equal(result.error, undefined)
  assert.deepEqual(result.completed, ['manage-applications', 'tailor-resume', 'distill-resume', 'distill-project', 'interview-prep'])
  assert(fs.lstatSync(join(path, 'capture-job')).isSymbolicLink())
  assert(!fs.lstatSync(join(path, 'manage-applications')).isSymbolicLink())
  assert.equal(fs.readFileSync(join(external, 'SKILL.md'), 'utf8'), 'outside content')
})

test('missing or linked bundle resources and invalid destination parents do not write', t => {
  const f = fixture(t)
  fs.unlinkSync(join(f.source, 'tailor-resume', 'SKILL.md'))
  assert(f.status().skills.every(skill => skill.state === 'unavailable'))
  assert(!fs.existsSync(f.home))
  const g = fixture(t), saved = g.status()
  fs.symlinkSync(join(g.source, 'tailor-resume', 'SKILL.md'), join(g.source, 'capture-job', 'linked.md'))
  const result = g.service.install({ target: 'codex', revision: saved.revision, replace: false })
  assert(result.error)
  assert(!fs.existsSync(g.home))
  fs.mkdirSync(f.home); fs.writeFileSync(join(f.home, '.agents'), 'not a directory')
  assert.equal(f.status().error, 'SKILLS_UNAVAILABLE')
})

test('version checks catch destination and bundle changes during staging, before any replacement', t => {
  const f = fixture(t), copy = fs.cpSync, path = f.status().path
  let mutate = true
  t.mock.method(fs, 'cpSync', (...args: Parameters<typeof copy>) => {
    const result = copy(...args)
    if (mutate) {
      mutate = false
      fs.mkdirSync(join(path, 'manage-applications'), { recursive: true })
      fs.writeFileSync(join(path, 'manage-applications', 'SKILL.md'), 'concurrent edit')
    }
    return result
  })
  const result = f.install()
  assert.equal(result.error, 'SKILLS_CHANGED')
  assert.deepEqual(result.completed, [])
  assert(!fs.existsSync(join(path, 'capture-job')))
  assert.equal(fs.readFileSync(join(path, 'manage-applications', 'SKILL.md'), 'utf8'), 'concurrent edit')
  assert(!fs.readdirSync(path).some(name => name.startsWith('.job-agent-skills-')))
  t.mock.restoreAll()
  const g = fixture(t)
  t.mock.method(fs, 'cpSync', (...args: Parameters<typeof copy>) => {
    const result = copy(...args)
    fs.writeFileSync(join(g.source, 'capture-job', 'SKILL.md'), 'new source after staging')
    return result
  })
  const changedSource = g.install()
  assert.equal(changedSource.error, 'SKILLS_CHANGED')
  assert.deepEqual(changedSource.completed, [])
})

test('partial failure reports actual completed and pending items and can be retried', t => {
  const f = fixture(t), rename = fs.renameSync
  t.mock.method(fs, 'renameSync', (...args: Parameters<typeof rename>) => {
    if (String(args[1]).endsWith('manage-applications')) throw Object.assign(new Error('private OS details'), { code: 'EACCES' })
    return rename(...args)
  })
  const result = f.install()
  assert.equal(result.error, 'INSTALL_FAILED')
  assert.deepEqual(result.completed, ['capture-job'])
  assert.deepEqual(result.pending, ['manage-applications', 'tailor-resume', 'distill-resume', 'distill-project', 'interview-prep'])
  assert(!JSON.stringify(result).includes('private OS details'))
  assert(!fs.readdirSync(result.status.path).some(name => name.startsWith('.job-agent-skills-')))
  t.mock.restoreAll()
  assert.deepEqual(f.install().completed, ['manage-applications', 'tailor-resume', 'distill-resume', 'distill-project', 'interview-prep'])
})

test('unwritable destinations report failure without overwriting existing Skills', t => {
  if (process.getuid?.() === 0) { t.skip('Root can bypass POSIX file permissions'); return }
  const f = fixture(t), path = f.status().path
  fs.mkdirSync(path, { recursive: true }); fs.chmodSync(path, 0o500)
  try {
    const result = f.install()
    assert.equal(result.error, 'INSTALL_FAILED')
    assert.deepEqual(result.completed, [])
    assert.deepEqual(fs.readdirSync(path), [])
  } finally { fs.chmodSync(path, 0o700) }
})

test('fixed operations reject arbitrary paths and malformed requests; folder opening is fixed and sanitized', async t => {
  const f = fixture(t)
  assert.throws(() => f.service.inspect({ path: '/arbitrary' }), { code: 'INVALID_INPUT' })
  for (const value of [null, [], {}, { target: 'other', revision: 'a'.repeat(64), replace: true },
    { target: 'codex', revision: f.status().revision, replace: 'yes' },
    { target: 'codex', revision: f.status().revision, replace: true, path: '/arbitrary' }]) {
    assert.throws(() => f.service.install(value), { code: 'INVALID_INPUT' })
  }
  assert.equal(await f.service.openBundle({}), null)
  assert.equal(f.opened(), f.source)
  await assert.rejects(f.service.openBundle({ path: '/arbitrary' }), { code: 'INVALID_INPUT' })
  const failed = createExternalSkillsInstaller({ home: f.home, bundleDirectory: f.source, async openPath() { return 'private OS details' } })
  await assert.rejects(failed.openBundle({}), { code: 'OPEN_FAILED' })
})

test('preload exposes only fixed Skills lifecycle and bundle operations', async () => {
  const calls: unknown[] = []
  const bridge = createExternalSkillsBridge(async (method, input) => { calls.push([method, input]); return { ok: true, value: null } })
  assert.deepEqual(Object.keys(bridge), ['inspect', 'install', 'reconnect', 'remove', 'openBundle'])
  await bridge.inspect({}); await bridge.openBundle({})
  await bridge.install({ target: 'codex', revision: 'a'.repeat(64), replace: false })
  const change = { target: 'codex' as const, revision: 'a'.repeat(64), replace: false }
  await bridge.reconnect(change); await bridge.remove({ target: change.target, revision: change.revision, names: ['capture-job'] })
  assert.deepEqual(calls, [['inspect', {}], ['openBundle', {}], ['install', change], ['reconnect', change],
    ['remove', { target: change.target, revision: change.revision, names: ['capture-job'] }]])
})
