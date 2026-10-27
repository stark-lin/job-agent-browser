const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { distributionLock } = require('../scripts/prepare-npm-package.cjs')
const { verifyArtifact, registryVersion, publishArtifact } = require('../scripts/publish-npm.cjs')
const { verifyMetadataAndDocs } = require('../scripts/verify-npm-package.cjs')
const root = join(__dirname, '..')
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
test('new versions publish publicly to latest with provenance and verify registry integrity', () => {
  const artifact = { report: { name: '@stark-lin/jab', version: '0.1.0-main.4.gbbbbbbb' }, path: '/verified/jab.tgz', integrity: 'sha512-verified' }
  const calls = []
  const lookup = ['view', `${artifact.report.name}@${artifact.report.version}`, 'dist.integrity', '--json', '--registry=https://registry.npmjs.org/']
  publishArtifact(artifact, (command, args) => {
    calls.push([command, args])
    if (calls.length === 1) return { status: 1, stdout: '{"error":{"code":"E404"}}' }
    return { status: 0, stdout: JSON.stringify(artifact.integrity) }
  })
  assert.deepEqual(calls, [
    ['npm', lookup],
    ['npm', ['publish', artifact.path, '--access', 'public', '--tag', 'latest', '--provenance', '--registry=https://registry.npmjs.org/']],
    ['npm', lookup]
  ])
})
test('existing-version retries verify integrity without republishing or moving any dist-tag', () => {
  const artifact = { report: { name: '@stark-lin/jab', version: '0.1.0-main.3.gaaaaaaa' }, integrity: 'sha512-verified' }
  for (const latest of [artifact.report.version, '0.1.0-main.4.gbbbbbbb', undefined]) {
    for (const integrity of [artifact.integrity, 'sha512-different']) {
      const tags = { latest, next: artifact.report.version }, original = { ...tags }
      let calls = 0
      const run = () => publishArtifact(artifact, (command, args) => {
        calls++
        assert.equal(command, 'npm')
        assert.deepEqual(args, ['view', `${artifact.report.name}@${artifact.report.version}`, 'dist.integrity', '--json', '--registry=https://registry.npmjs.org/'])
        return { status: 0, stdout: JSON.stringify(integrity) }
      })
      if (integrity === artifact.integrity) run()
      else assert.throws(run, /different bytes/)
      assert.equal(calls, 1, 'Retry must perform only the integrity lookup')
      assert.deepEqual(tags, original)
    }
  }
})
test('registry and publish failures cannot bypass integrity checks or mutate tags on retry', () => {
  const artifact = { report: { name: '@stark-lin/jab', version: '0.1.0-main.3.gaaaaaaa' }, path: '/verified/jab.tgz', integrity: 'sha512-verified' }
  for (const failure of [
    { status: 1, stdout: '{"error":{"code":"E401"}}' },
    { status: 1, stdout: '{"error":{"code":"E500"}}' },
    { status: 1, stderr: 'network down' },
    { status: 0, stdout: '{}' }
  ]) {
    let calls = 0
    assert.throws(() => publishArtifact(artifact, () => { calls++; return failure }))
    assert.equal(calls, 1)
  }
  for (const [published, error] of [[{ status: 1 }, /PUBLISH_FAILED_GITHUB_RELEASE_RETAINED/], [{ status: 0 }, /digest mismatch/]]) {
    const calls = []
    assert.throws(() => publishArtifact(artifact, (_command, args) => {
      calls.push(args[0])
      if (calls.length === 1) return { status: 1, stdout: '{"error":{"code":"E404"}}' }
      if (args[0] === 'publish') return published
      return { status: 0, stdout: '"sha512-different"' }
    }), error)
    assert.deepEqual(calls, published.status ? ['view', 'publish'] : ['view', 'publish', 'view'])
  }
})
test('package metadata uses latest and documentation comes from the npm consumer guide', t => {
  const directory = mkdtempSync(join(tmpdir(), 'jab-npm-docs-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const template = require('../packages/npm/package.template.json')
  assert.equal(template.publishConfig.tag, 'latest')
  assert.equal(template.name, '@stark-lin/jab')
  assert.equal(template.description, 'Job Agent Browser: desktop GUI, Smart Note and local MCP tools.')
  assert.equal(template.license, 'AGPL-3.0-only')
  assert.equal(template.repository.url, 'git+https://github.com/stark-lin/job-agent-browser.git')
  assert.equal(template.homepage, 'https://github.com/stark-lin/job-agent-browser#readme')
  assert.deepEqual(template.bin, { jab: 'bin/jab.cjs' })
  assert.deepEqual(template.engines, { node: '>=24.10.0' })
  writeFileSync(join(directory, 'package.json'), JSON.stringify(template))
  writeFileSync(join(directory, 'LICENSE'), readFileSync(join(root, 'LICENSE')))
  for (const name of ['README.md', 'README.zh-CN.md']) {
    writeFileSync(join(directory, name), readFileSync(join(root, 'packages/npm', name)))
    for (const path of [join(root, name), join(root, 'packages/npm', name)]) {
      const body = readFileSync(path, 'utf8')
      assert(body.includes('npm install -g @stark-lin/jab\n'))
      assert(!body.includes('@stark-lin/jab@next'))
    }
    const body = readFileSync(join(directory, name), 'utf8')
    assert(body.includes('npm install -g @stark-lin/jab@latest'))
    assert(body.includes('npx @stark-lin/jab\n'))
    assert(body.includes('https://github.com/stark-lin/job-agent-browser/blob/main/LICENSE'))
  }
  verifyMetadataAndDocs(directory)
  writeFileSync(join(directory, 'README.md'), readFileSync(join(root, 'README.md')))
  assert.throws(() => verifyMetadataAndDocs(directory), /Must use npm consumer README/)
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
