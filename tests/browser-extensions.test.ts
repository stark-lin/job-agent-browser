import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { lstat, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { firstPartyFixture } from './first-party-fixture'
import { BrowserExtensionInstaller, ExtensionImportError } from '../src/platform/browser/extension-installer'
import { BrowserExtensionStore } from '../src/platform/storage/browser-extensions'

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'jab-extension-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new BrowserExtensionStore(join(directory, 'profile'))
  const installer = new BrowserExtensionInstaller(store)
  const otherProcess = new BrowserExtensionInstaller(new BrowserExtensionStore(join(directory, 'profile')))
  const signal = new AbortController().signal
  async function unpack(name: string, manifest: Record<string, unknown> = {}) {
    const path = join(directory, name)
    await mkdir(path)
    await writeFile(join(path, 'manifest.json'), JSON.stringify({ name, version: '1.2.3', manifest_version: 3, options_ui: { page: 'options.html' }, ...manifest }))
    await writeFile(join(path, 'options.html'), '<!doctype html><title>Extension options</title>')
    return path
  }
  return { directory, installer, otherProcess, store, signal, unpack }
}

test('extension imports serialize across store instances, preserve enabled state and replay receipts', async t => {
  const { installer, otherProcess, store, signal, unpack } = await fixture(t)
  const source = await unpack('first'), second = await unpack('second')
  const request = randomUUID()
  const [result, another] = await Promise.all([
    installer.installFromMCP(source, request, signal),
    otherProcess.installFromMCP(second, randomUUID(), signal)
  ])
  assert.equal(result.status, 'INSTALLED_DISABLED')
  assert.equal(another.status, 'INSTALLED_DISABLED')
  await store.locked((index, commit) => {
    index.extensions.find(row => row.id === result.extensionId)!.enabled = true
    commit()
  })
  assert.deepEqual(await installer.installFromMCP(source, request, signal), result)
  assert.deepEqual(await installer.installFromMCP(second, request, signal), { status: 'REQUEST_CONFLICT' })
  const duplicate = await installer.installFromMCP(source, randomUUID(), signal)
  assert.equal(duplicate.status, 'ALREADY_INSTALLED')
  assert.equal(duplicate.enabled, true)
  assert.equal(duplicate.extensionId, result.extensionId)
  assert.equal(store.read().extensions.length, 2)
  assert(!JSON.stringify(store.read()).includes(source))
  assert.equal(await readFile(join(await store.packagePath(result.extensionId), 'options.html'), 'utf8'), '<!doctype html><title>Extension options</title>')

  await store.locked((index, commit) => {
    const row = index.extensions.find(item => item.id === result.extensionId)!
    row.enabled = false
    row.pendingRemoval = true
    commit()
  })
  assert.deepEqual(await installer.installFromMCP(source, request, signal), { status: 'PENDING_REMOVAL' })
  assert.deepEqual(await installer.installFromMCP(source, randomUUID(), signal), { status: 'PENDING_REMOVAL' })
  await store.locked((index, commit) => {
    index.extensions = index.extensions.filter(row => row.id !== result.extensionId)
    commit()
  })
  assert.deepEqual(await installer.installFromMCP(source, request, signal), { status: 'REQUEST_STALE' })
  assert.equal((await installer.installFromMCP(source, randomUUID(), signal)).status, 'INSTALLED_DISABLED')
})

test('installer binds manual consent to package bytes and rejects unsafe or conflicting imports', async t => {
  const { directory, installer, store, signal, unpack } = await fixture(t)
  const path = await unpack('manual')
  const first = await installer.inspect(path)
  await writeFile(join(path, 'options.html'), 'changed')
  await assert.rejects(installer.installManual(path, first.fingerprint),
    error => error instanceof ExtensionImportError && error.code === 'SOURCE_CHANGED')
  const { fingerprint } = await installer.inspect(path)
  const manual = await installer.installManual(path, fingerprint)
  assert.equal(manual.enabled, true)
  assert.equal(manual.source, 'manual')
  assert.deepEqual(await installer.verify(manual), await store.packagePath(manual.id))

  const key = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const one = await unpack('key-one', { key })
  const two = await unpack('key-two', { key, version: '2' })
  const install = (source: string) => installer.installFromMCP(source, randomUUID(), signal)
  assert.equal((await install(one)).status, 'INSTALLED_DISABLED')
  assert.equal((await install(two)).status, 'INVALID_MANIFEST')
  assert.equal((await install(await unpack('mv2', { manifest_version: 2 }))).status, 'INVALID_MANIFEST')
  assert.equal((await install(await unpack('escape', { options_ui: { page: '../options.html' } }))).status, 'INVALID_MANIFEST')
  assert.equal((await install(await unpack('encoded', { background: { service_worker: '%2e%2e/script.js' } }))).status, 'INVALID_MANIFEST')
  const symlinked = await unpack('symlinked'), hardlinked = await unpack('hardlinked')
  await symlink(join(path, 'options.html'), join(symlinked, 'escape.html'))
  await link(join(path, 'options.html'), join(hardlinked, 'escape.html'))
  for (const input of [symlinked, hardlinked, 'relative', 'https://example.invalid/file.zip', join(path, 'manifest.json'), join(directory, 'missing')]) {
    assert.deepEqual(await install(input), { status: 'INVALID_PATH' })
  }
  assert.equal(store.read().extensions.length, 2)
  assert.deepEqual(await readdir((await store.directories()).staging), [])
})

test('startup recovery removes only uncommitted package directories and retains invalid indexes', async t => {
  const { installer, store, unpack } = await fixture(t)
  const path = await unpack('installed')
  const installed = await installer.installManual(path, (await installer.inspect(path)).fingerprint)
  const { staging, packages } = await store.directories()
  const stagingOrphan = join(staging, randomUUID()), packageOrphan = join(packages, randomUUID())
  await mkdir(stagingOrphan)
  await mkdir(packageOrphan)
  await writeFile(store.indexPath, '{broken')
  await assert.rejects(store.recover())
  assert.equal(await readFile(store.indexPath, 'utf8'), '{broken')
  assert((await lstat(stagingOrphan)).isDirectory())
  assert((await lstat(packageOrphan)).isDirectory())

  await writeFile(store.indexPath, JSON.stringify({ version: 1, extensions: [installed], receipts: {} }))
  await store.recover()
  assert.deepEqual(await readdir(staging), [])
  assert.deepEqual(await readdir(packages), [installed.id])
})

test('authenticated Ask installs through stdio and counts only one confirmed installation', async t => {
  const f = await firstPartyFixture(t)
  const signal = new AbortController().signal
  const ask = await f.askRun(signal)
  const path = join(f.directory, 'unpacked-ask-fixture')
  await mkdir(path)
  await writeFile(join(path, 'manifest.json'), JSON.stringify({ name: 'Ask Fixture', manifest_version: 3, version: '1' }))
  const input = { path, requestId: randomUUID() }
  const exposed = (await ask.list()).filter(tool => tool.name.startsWith('browser.extension.')).map(tool => tool.name).sort()
  assert.deepEqual(exposed, ['browser.extension.install', 'browser.extension.list'])
  const result = await ask.call('browser.extension.install', input, signal) as { status: string; extensionId: string }
  assert.equal(result.status, 'INSTALLED_DISABLED')
  const progress = ask.getRunGuardSnapshot()?.progress
  assert.equal(progress, 1)
  assert.deepEqual(await ask.call('browser.extension.install', input, signal), result)
  assert.equal(ask.getRunGuardSnapshot()?.progress, progress)
  const duplicate = await ask.call('browser.extension.install', { ...input, requestId: randomUUID() }, signal) as { status: string }
  assert.equal(duplicate.status, 'ALREADY_INSTALLED')
  assert.equal(ask.getRunGuardSnapshot()?.progress, progress)
  assert.deepEqual(await ask.call('browser.extension.list', {}, signal), { extensions: [{
    id: result.extensionId, name: 'Ask Fixture', version: '1', source: 'mcp', enabled: false
  }] })
  await assert.rejects(ask.call('browser.extension.setEnabled', { id: result.extensionId }, signal), { code: 'TOOL_FORBIDDEN' })
  assert(!JSON.stringify(f.backend.toolAudit.list()).includes(path))
})
