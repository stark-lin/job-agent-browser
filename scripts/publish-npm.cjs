const assert = require('node:assert/strict')
const { readFileSync, readdirSync, lstatSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { metadata } = require('./release-metadata.cjs')
function verifyArtifact(directory, expected) {
  const report = JSON.parse(readFileSync(join(directory, 'manifest.json')))
  assert.equal(report.name, '@stark-lin/jab'); assert.equal(report.version, expected.version); assert.equal(report.sha, expected.sha)
  assert.equal(report.tarball, `stark-lin-jab-${expected.version}.tgz`)
  assert.equal(report.modelRevision, require('../resources/embedding-model.json').revision)
  assert.equal(report.runtimeVerified, true)
  assert.equal(report.runtime?.platform, 'darwin'); assert.equal(report.runtime?.arch, 'arm64')
  for (const field of ['gui', 'mcp', 'pdf', 'keywordFallback', 'reinstall', 'semantic']) assert.equal(report.runtime[field], true)
  assert.deepEqual(readdirSync(directory).sort(), ['manifest.json', report.tarball].sort())
  const path = join(directory, report.tarball)
  assert(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink())
  const bytes = readFileSync(path)
  assert.equal(bytes.length, report.size)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), report.sha256)
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
  assert.equal(report.integrity, integrity)
  // Read metadata from the exact tarball without unpacking untrusted paths.
  const unpack = spawnSync('tar', ['-xOf', path, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1048576 })
  assert.equal(unpack.status, 0, unpack.stderr)
  const pkg = JSON.parse(unpack.stdout)
  assert.equal(pkg.name, report.name); assert.equal(pkg.version, expected.version); assert.equal(pkg.jab.gitSha, expected.sha); assert.equal(pkg.jab.modelRevision, report.modelRevision)
  assert.equal(pkg.license, 'AGPL-3.0-only'); assert.equal(pkg.dependencies.electron, require('../package-lock.json').packages['node_modules/electron'].version)
  return { report, path, integrity }
}
function registryVersion(name, version, runner = spawnSync) {
  const result = runner('npm', ['view', `${name}@${version}`, 'dist.integrity', '--json', '--registry=https://registry.npmjs.org/'], { encoding: 'utf8' })
  if (result.status === 0) {
    const value = JSON.parse(result.stdout)
    if (typeof value !== 'string' || !value.startsWith('sha512-')) throw new Error('NPM_REGISTRY_INTEGRITY_MISSING')
    return value
  }
  let error
  try { error = JSON.parse(result.stdout || result.stderr).error } catch {}
  if (error?.code === 'E404') return null
  throw new Error('NPM_REGISTRY_LOOKUP_FAILED')
}
async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('NPM_RELEASE_REQUIRES_MAIN')
  const npmVersion = spawnSync('npm', ['--version'], { encoding: 'utf8' })
  const parts = npmVersion.stdout?.trim().split('.').map(Number)
  if (npmVersion.status !== 0 || !parts || parts.length !== 3 || parts.some(n => !Number.isInteger(n)) ||
    parts[0] < 11 || parts[0] === 11 && (parts[1] < 5 || parts[1] === 5 && parts[2] < 1)) throw new Error('NPM_11_5_1_REQUIRED')
  const expected = metadata(require('../package.json').version, process.env.GITHUB_RUN_NUMBER, process.env.GITHUB_SHA)
  const artifact = verifyArtifact(resolve(__dirname, '../release/npm'), expected)
  const existing = registryVersion(artifact.report.name, expected.version)
  if (existing) {
    assert.equal(existing, artifact.integrity, 'Existing npm version has different bytes; it cannot be overwritten')
    console.log('Existing npm version matches the verified artifact.'); return
  }
  const result = spawnSync('npm', ['publish', artifact.path, '--access', 'public', '--tag', 'next', '--provenance', '--registry=https://registry.npmjs.org/'], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error('NPM_PUBLISH_FAILED_GITHUB_RELEASE_RETAINED')
  assert.equal(registryVersion(artifact.report.name, expected.version), artifact.integrity, 'Published npm digest mismatch')
  console.log(`Published ${artifact.report.name}@${expected.version} with tag next.`)
}
module.exports = { verifyArtifact, registryVersion }
if (require.main === module) void main().catch(error => { console.error(error.message); process.exitCode = 1 })
