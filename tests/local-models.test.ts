import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import manifest from '../resources/embedding-model.json'
import { LocalModelManager } from '../src/platform/models/manager'
import { userModelStore } from '../src/platform/models/paths'
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const model = { ...manifest, id: 'fixture', files: [
  { path: 'config.json', size: 6, sha256: sha('config') },
  { path: 'onnx/model.onnx', size: 7, sha256: sha('weights') }
] }
const fetcher: typeof fetch = async url => new Response(String(url).endsWith('config.json') ? 'config' : 'weights')
test('verified installation, restart detection, repair, seed opt-out and persistence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jab-model-'))
  let activations = 0, stops = 0, requests = 0
  const create = () => new LocalModelManager({ root, seed: join(root, 'seed'), model,
    stop: () => { stops++ }, activated: () => { activations++ }, fetcher: async (...args) => { requests++; return fetcher(...args) } })
  let manager = create()
  try {
    await manager.ready
    assert.equal(manager.status().state, 'missing')
    await manager.install('download')
    assert(manager.available()); assert.equal(requests, 2); assert(activations > 0)
    assert.equal(JSON.parse(await readFile(join(manager.store.directory, '.installed.json'), 'utf8')).revision, model.revision)
    await manager.close()
    manager = create(); await manager.ready; assert(manager.available()); assert.equal(requests, 2)
    await writeFile(join(manager.store.directory, 'config.json'), 'broken')
    assert.equal((await manager.verify()).state, 'corrupted'); assert(!manager.available())
    await manager.install('download'); assert(manager.available())
    await mkdir(join(root, 'seed'), { recursive: true })
    await manager.remove(); assert.equal(manager.status().state, 'missing'); assert(stops > 0)
    await manager.close()
    manager = create(); await manager.ready; assert.equal(manager.status().state, 'missing')
    const prefs = JSON.parse(await readFile(join(root, 'seed-preferences.json'), 'utf8'))
    assert.equal(prefs.autoImportSeed, false)
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }) }
})
test('cancellation keeps verified files, rejects concurrent installation and resumes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jab-model-cancel-'))
  let waiting!: () => void
  const reached = new Promise<void>(resolve => { waiting = resolve })
  let block = true, configRequests = 0
  const manager = new LocalModelManager({ root, model, stop() {}, activated() {}, fetcher: async (url, init) => {
    if (String(url).endsWith('config.json')) configRequests++
    else if (block) { waiting(); await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) }
    return fetcher(url, init)
  } })
  try {
    await manager.ready
    const work = manager.install('download'); const failure = assert.rejects(work, /CANCELLED/)
    await reached
    await assert.rejects(manager.install('download'), /BUSY/)
    await manager.cancel(); await failure
    assert(!manager.available())
    block = false; await manager.install('download')
    assert(manager.available()); assert.equal(configRequests, 1)
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }) }
})
test('offline seed is verified, imported once and never used as inference path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jab-model-seed-'))
  const seed = join(root, 'seed')
  await mkdir(join(seed, 'onnx'), { recursive: true })
  await writeFile(join(seed, 'config.json'), 'config'); await writeFile(join(seed, 'onnx/model.onnx'), 'weights')
  const create = () => new LocalModelManager({ root: join(root, 'user'), seed, model, stop() {}, activated() {}, fetcher: async () => { throw new Error('offline') } })
  let manager = create()
  try {
    await manager.ready; assert(manager.available()); assert.notEqual(manager.store.directory, seed)
    await manager.remove(); await manager.close()
    manager = create(); await manager.ready; assert.equal(manager.status().state, 'missing')
    await writeFile(join(seed, 'config.json'), 'broken')
    await assert.rejects(manager.install('seed')); assert(!manager.available())
  } finally { await manager.close(); await rm(root, { recursive: true, force: true }) }
})
test('installation lock coordinates independent managers and rejects unsafe paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jab-model-lock-'))
  const a = new LocalModelManager({ root, model, stop() {}, activated() {}, fetcher })
  await a.ready
  const b = new LocalModelManager({ root, model, stop() {}, activated() {}, fetcher })
  try {
    await b.ready
    const unlock = await a.store.lock(() => {})
    try { await assert.rejects(b.install('download'), /BUSY/) } finally { await unlock() }
    const outside = join(root, 'outside'); await mkdir(outside)
    await mkdir(join(root, '.staging'), { recursive: true })
    await symlink(outside, a.store.staging)
    await assert.rejects(a.install('download')); assert(!a.available())
  } finally { await a.close(); await b.close(); await rm(root, { recursive: true, force: true }) }
})
test('model paths do not depend on package location or working directory', () => {
  assert.equal(userModelStore('darwin', {}, '/home/alice'), '/home/alice/Library/Application Support/JAB/managed-models')
  assert.equal(userModelStore('linux', { XDG_DATA_HOME: '/data' }, '/home/alice'), '/data/JAB/models')
  assert.throws(() => userModelStore('linux', { JAB_MODEL_STORE: 'relative' }, '/home/alice'))
})

test('active inference leases prevent another instance from removing or replacing weights', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jab-model-readers-'))
  const create = () => new LocalModelManager({ root, model, stop() {}, activated() {}, fetcher })
  const a = create(); await a.ready; await a.install('download')
  const b = create(); await b.ready
  try {
    const release = await a.acquireLease(() => {})
    try {
      await assert.rejects(b.remove(), /BUSY/)
      assert.equal(await readFile(join(a.store.directory, 'config.json'), 'utf8'), 'config')
      await assert.rejects(b.install('download'), /BUSY/)
    } finally { await release() }
    await b.remove(); assert(!a.available())
  } finally { await a.close(); await b.close(); await rm(root, { recursive: true, force: true }) }
})

test('a lock held by a separate process prevents installation until that process exits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jab-model-process-'))
  const manager = new LocalModelManager({ root, model, stop() {}, activated() {}, fetcher })
  await manager.ready
  const entry = require.resolve('proper-lockfile')
  const code = `require(${JSON.stringify(entry)}).lock(process.argv[1],{realpath:false,stale:30000}).then(()=>{process.stdout.write('locked');process.stdin.resume();process.on('SIGTERM',()=>process.exit(0))})`
  const child = spawn(process.execPath, ['-e', code, join(root, '.locks', model.id)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    const [chunk] = await once(child.stdout, 'data')
    assert.equal(chunk.toString(), 'locked')
    await assert.rejects(manager.install('download'), /BUSY/)
    const exited = once(child, 'exit'); child.kill(); await exited
    await manager.install('download'); assert(manager.available())
  } finally { child.kill(); await manager.close(); await rm(root, { recursive: true, force: true }) }
})
