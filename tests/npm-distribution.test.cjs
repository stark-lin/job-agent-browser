const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { distributionLock } = require('../scripts/prepare-npm-package.cjs')
const { verifyArtifact, registryVersion } = require('../scripts/publish-npm.cjs')
test('distribution shrinkwrap closes over production and Electron dependencies with exact locked versions', () => {
  const original = require('../package-lock.json'), source = require('../package.json')
  const pkg = { name: '@stark-lin/jab', version: '1.2.3', dependencies: {} }
  for (const name of [...Object.keys(source.dependencies), 'electron']) pkg.dependencies[name] = original.packages['node_modules/' + name].version
  const result = distributionLock(pkg, original)
  assert.equal(result.version, pkg.version)
  assert.deepEqual(result.packages[''].dependencies, pkg.dependencies)
  assert(result.packages['node_modules/electron'])
  assert(result.packages['node_modules/onnxruntime-node'])
  assert(!result.packages['node_modules/electron-builder'])
  for (const [name, value] of Object.entries(result.packages).slice(1)) {
    assert.equal(value.version, original.packages[name].version)
    assert.equal(value.integrity, original.packages[name].integrity)
    assert.equal(value.dev, undefined)
  }
  assert.equal(original.packages['node_modules/electron'].dev, true, 'Do not mutate source lock')
})
test('registry retry distinguishes identical versions, absent versions and lookup failures', () => {
  assert.equal(registryVersion('x', '1', () => ({ status: 0, stdout: '"sha512-verified"' })), 'sha512-verified')
  assert.equal(registryVersion('x', '1', () => ({ status: 1, stdout: '{"error":{"code":"E404"}}' })), null)
  assert.throws(() => registryVersion('x', '1', () => ({ status: 1, stdout: '{"error":{"code":"E401"}}' })), /LOOKUP_FAILED/)
  assert.throws(() => registryVersion('x', '1', () => ({ status: 1, stderr: 'network down' })), /LOOKUP_FAILED/)
  assert.throws(() => registryVersion('x', '1', () => ({ status: 0, stdout: '{}' })), /INTEGRITY_MISSING/)
})
test('publication verifies exact tarball metadata, platform, runtime gates, SHA and digests', t => {
  const root = mkdtempSync(join(tmpdir(), 'jab-npm-gate-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source/package'), output = join(root, 'artifact')
  mkdirSync(source, { recursive: true }); mkdirSync(output)
  const expected = { version: '0.1.0-main.1.gaaaaaaa', sha: 'a'.repeat(40) }
  const pkg = { name: '@stark-lin/jab', version: expected.version, jab: { gitSha: expected.sha, modelRevision: require('../resources/embedding-model.json').revision }, license: 'AGPL-3.0-only', dependencies: { electron: require('../package-lock.json').packages['node_modules/electron'].version } }
  writeFileSync(join(source, 'package.json'), JSON.stringify(pkg))
  const tarball = `stark-lin-jab-${expected.version}.tgz`, path = join(output, tarball)
  assert.equal(spawnSync('tar', ['-czf', path, '-C', join(root, 'source'), 'package']).status, 0)
  const bytes = readFileSync(path)
  const report = { modelRevision: pkg.jab.modelRevision, name: pkg.name, version: expected.version, sha: expected.sha, tarball, size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    runtimeVerified: true, runtime: { platform: 'darwin', arch: 'arm64', gui: true, mcp: true, pdf: true, keywordFallback: true, reinstall: true, semantic: true } }
  const write = value => writeFileSync(join(output, 'manifest.json'), JSON.stringify(value))
  write(report); assert.equal(verifyArtifact(output, expected).path, path)
  for (const changed of [{ ...report, runtimeVerified: false }, { ...report, sha: 'b'.repeat(40) }, { ...report, tarball: '../escape' }, { ...report, sha256: '0'.repeat(64) }, { ...report, runtime: { ...report.runtime, arch: 'x64' } }, { ...report, runtime: { ...report.runtime, pdf: false } }]) {
    write(changed); assert.throws(() => verifyArtifact(output, expected))
  }
  write(report); writeFileSync(join(output, 'unexpected'), 'extra'); assert.throws(() => verifyArtifact(output, expected))
})
test('npm CLI parses explicit absolute data paths and never guesses an MCP database', () => {
  const { parse } = require('../packages/npm/bin/jab.cjs')
  assert.equal(parse(['mcp', '--data-dir', '/tmp/jab']).directory, '/tmp/jab')
  assert.throws(() => parse(['--data-dir']), /requires/)
  assert.throws(() => parse(['--data-dir', 'relative']), /absolute/)
})
