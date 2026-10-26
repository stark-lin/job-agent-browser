const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, writeFile, readFile, readdir, rm } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { createHash } = require('node:crypto')
const { prepare, digest, validateManifest } = require('../scripts/prepare-embedding-model.cjs')
const { metadata } = require('../scripts/release-metadata.cjs')
const { verifyAssets } = require('../scripts/publish-release.cjs')
const sha = text => createHash('sha256').update(text).digest('hex')
async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'jab-release-test-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}
test('fixed revision downloads are atomic, fully verified and reused without network', async t => {
  const directory = await fixture(t)
  const model = { id: 'test', source: 'owner/model', revision: 'a'.repeat(40), files: [{ path: 'model.onnx', size: 5, sha256: sha('valid') }] }
  let calls = 0
  const fetcher = async url => { calls++; assert(url.includes('/resolve/' + model.revision + '/')); return new Response('valid') }
  await prepare({ directory, model, fetcher })
  await prepare({ directory, model, fetcher })
  await prepare({ directory, model, verify: true, fetcher: () => { throw new Error('Must be offline') } })
  assert.equal(calls, 1)
  assert.deepEqual(await readdir(directory), ['model.onnx'])
  await writeFile(join(directory, 'model.onnx'), 'wrong')
  await assert.rejects(prepare({ directory, model, verify: true }), /CHECKSUM/)
  await assert.rejects(prepare({ directory, model, fetcher: async () => new Response('bad') }), /CHECKSUM/)
  assert.equal(await readFile(join(directory, 'model.onnx'), 'utf8'), 'wrong')
  assert.deepEqual(await readdir(directory), ['model.onnx'])
  for (const path of ['../escape', '/absolute', 'x/../escape', 'x\\escape']) assert.throws(() => validateManifest({ ...model, files: [{ ...model.files[0], path }] }))
})
test('release identity is stable on rerun and Windows numeric version is bounded', () => {
  const value = metadata('0.1.0', '123', 'a'.repeat(40))
  assert.equal(value.version, '0.1.0-main.123.aaaaaaa')
  assert.equal(value.buildVersion, '0.1.0.123')
  assert.deepEqual(value, metadata('0.1.0', '123', 'a'.repeat(40)))
  for (const run of ['0', '65536', 'bad']) assert.throws(() => metadata('0.1.0', run, 'a'.repeat(40)))
})
test('publication requires all four verified targets and rejects corrupt or mixed-commit installers', async t => {
  const directory = await fixture(t), meta = metadata('0.1.0', 3, 'b'.repeat(40))
  const model = require('../resources/embedding-model.json')
  const manifestHash = await digest(join(__dirname, '../resources/embedding-model.json'))
  const targets = [['linux', 'x64', 'AppImage'], ['mac', 'arm64', 'dmg'], ['mac', 'x64', 'dmg'], ['win', 'x64', 'exe']]
  for (const [platform, arch, ext] of targets) {
    const name = `JAB-${meta.version}-${platform}-${arch}.${ext}`
    await writeFile(join(directory, name), 'installer')
    await writeFile(join(directory, `${platform}-${arch}.json`), JSON.stringify({ ...meta, platform, arch,
      modelRevision: model.revision, modelManifest: manifestHash, runtimeVerified: true, signing: 'unsigned',
      assets: [{ name, size: 9, sha256: sha('installer') }] }))
  }
  assert.equal((await verifyAssets(directory, meta)).files.length, 4)
  const target = join(directory, 'win-x64.json'), original = await readFile(target, 'utf8')
  await writeFile(target, original.replace(meta.sha, 'c'.repeat(40)))
  await assert.rejects(verifyAssets(directory, meta), /MANIFEST/)
  await writeFile(target, original)
  const asset = JSON.parse(original).assets[0]
  await writeFile(join(directory, asset.name), 'corrupted')
  await assert.rejects(verifyAssets(directory, meta), /CHECKSUM/)
  await writeFile(join(directory, asset.name), 'installer')
  await rm(target)
  await assert.rejects(verifyAssets(directory, meta), /ENOENT/)
})
