const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { createRequire } = require('node:module')
const { distributionLock } = require('../scripts/prepare-npm-package.cjs')
const { verifyArtifact, registryVersion, publishArtifact } = require('../scripts/publish-npm.cjs')
const { verifyMetadataAndDocs } = require('../scripts/verify-npm-package.cjs')
const { initializeElectron, prepareModelFixture } = require('../scripts/npm-runtime-smoke.cjs')
const root = join(__dirname, '..')
const lookupArgs = version => ['view', `@stark-lin/jab@${version}`, 'dist.integrity', '--json', '--registry=https://registry.npmjs.org/', '--fetch-retries=0', '--fetch-timeout=10000']
test('clean-install Electron initialization retries transient downloads with bounded backoff', async t => {
  t.mock.method(console, 'error', () => {})
  for (const stderr of [
    'HTTPError: Response code 504 (Gateway Time-out)',
    'HTTPError: Response code 503 (Service Unavailable)',
    'HTTPError: Response code 429 (Too Many Requests)',
    'HTTPError: Response code 408 (Request Timeout)',
    'Error: ECONNRESET', 'Error: EAI_AGAIN', 'TypeError: fetch failed'
  ]) {
    const calls = [], waits = [], env = { electron_config_cache: '/shared/download-cache' }
    await initializeElectron('/clean-install/node_modules/@stark-lin/jab', env, {
      spawn: (command, args, options) => {
        calls.push({ command, args, options })
        return calls.length < 3 ? { status: 1, stderr } : { status: 0 }
      },
      wait: async ms => { waits.push(ms) }
    })
    assert.equal(calls.length, 3)
    assert.deepEqual(waits, [10000, 20000])
    for (const { command, args, options } of calls) {
      assert.equal(command, process.execPath)
      assert.deepEqual(args, ['-e', "require('electron')"])
      assert.equal(options.cwd, '/clean-install/node_modules/@stark-lin/jab')
      assert.equal(options.env, env)
      assert.equal(options.timeout, 120000)
    }
  }
})
test('persistent Electron download failures and timeouts remain fatal after three attempts', async t => {
  t.mock.method(console, 'error', () => {})
  for (const result of [
    { status: 1, stderr: 'HTTPError: Response code 504 (Gateway Time-out)' },
    { status: null, error: Object.assign(new Error('Electron download timed out'), { code: 'ETIMEDOUT' }) }
  ]) {
    let calls = 0
    const waits = []
    await assert.rejects(initializeElectron('/clean-install', {}, {
      spawn: () => { calls++; return result }, wait: async ms => { waits.push(ms) }
    }), result.error ? /Electron download timed out/ : /failed after 3 attempt\(s\).*\n.*\nHTTPError: Response code 504/)
    assert.equal(calls, 3)
    assert.deepEqual(waits, [10000, 20000])
  }
})
test('Electron integrity, permission, missing asset and process failures fail immediately', async t => {
  t.mock.method(console, 'error', () => {})
  for (const result of [
    { status: 1, stderr: 'HTTPError: Response code 404 (Not Found)' },
    { status: 1, stderr: 'SHA256 checksum mismatch' },
    { status: 1, stderr: 'Error: EACCES: permission denied' },
    { status: null, signal: 'SIGTERM' },
    { status: null, error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) }
  ]) {
    let calls = 0
    await assert.rejects(initializeElectron('/clean-install', {}, {
      spawn: () => { calls++; return result }, wait: async () => assert.fail('Must not retry permanent failures')
    }))
    assert.equal(calls, 1)
  }
})
test('Electron initialization uses the independently installed module in a fresh process on retry', async t => {
  t.mock.method(console, 'error', () => {})
  const directory = mkdtempSync(join(tmpdir(), 'jab-electron-init-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const electron = join(directory, 'node_modules/electron')
  mkdirSync(electron, { recursive: true })
  writeFileSync(join(electron, 'index.js'), `
const fs = require('node:fs'), path = require('node:path');
const marker = path.join(__dirname, 'download-attempted');
if (!fs.existsSync(marker)) {
  fs.writeFileSync(marker, '1');
  throw new Error('HTTPError: Response code 504 (Gateway Time-out)');
}
fs.writeFileSync(path.join(__dirname, 'initialized'), '1');
`)
  const waits = []
  await initializeElectron(directory, process.env, { wait: async ms => { waits.push(ms) } })
  assert.deepEqual(waits, [10000])
  assert.equal(readFileSync(join(electron, 'initialized'), 'utf8'), '1')
  await initializeElectron(directory, process.env, { wait: async () => assert.fail('Installed runtime must not wait') })
})
test('relocated model smoke resolves its UI and onboarding helpers outside the checkout', t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'jab-model-fixture-')))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const fixture = prepareModelFixture(directory), local = createRequire(fixture)
  assert.equal(readFileSync(fixture, 'utf8'), readFileSync(join(root, 'scripts/model-runtime-smoke.cjs'), 'utf8'))
  const helpers = [...readFileSync(fixture, 'utf8').matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)].map(match => match[1])
  assert(helpers.includes('./complete-onboarding.cjs'))
  for (const helper of helpers) {
    assert.equal(local.resolve(helper), join(directory, helper))
    assert.equal(typeof local(helper), 'function')
  }
})
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
test('new versions publish publicly to latest with provenance and verify registry integrity', async () => {
  const artifact = { report: { name: '@stark-lin/jab', version: '0.1.0-main.4.gbbbbbbb' }, path: '/verified/jab.tgz', integrity: 'sha512-verified' }
  const calls = []
  const lookup = lookupArgs(artifact.report.version)
  await publishArtifact(artifact, (command, args) => {
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
test('existing-version retries verify integrity without republishing or moving any dist-tag', async () => {
  const artifact = { report: { name: '@stark-lin/jab', version: '0.1.0-main.3.gaaaaaaa' }, integrity: 'sha512-verified' }
  for (const latest of [artifact.report.version, '0.1.0-main.4.gbbbbbbb', undefined]) {
    for (const integrity of [artifact.integrity, 'sha512-different']) {
      const tags = { latest, next: artifact.report.version }, original = { ...tags }
      let calls = 0
      const run = () => publishArtifact(artifact, (command, args) => {
        calls++
        assert.equal(command, 'npm')
        assert.deepEqual(args, lookupArgs(artifact.report.version))
        return { status: 0, stdout: JSON.stringify(integrity) }
      })
      if (integrity === artifact.integrity) await run()
      else await assert.rejects(run, /different bytes/)
      assert.equal(calls, 1, 'Retry must perform only the integrity lookup')
      assert.deepEqual(tags, original)
    }
  }
})
test('registry and publish failures cannot bypass integrity checks or mutate tags on retry', async () => {
  const artifact = { report: { name: '@stark-lin/jab', version: '0.1.0-main.3.gaaaaaaa' }, path: '/verified/jab.tgz', integrity: 'sha512-verified' }
  for (const failure of [
    { status: 1, stdout: '{"error":{"code":"E401"}}' },
    { status: 1, stdout: '{"error":{"code":"E500"}}' },
    { status: 1, stderr: 'network down' },
    { status: 0, stdout: '{}' }
  ]) {
    let calls = 0
    await assert.rejects(() => publishArtifact(artifact, () => { calls++; return failure }))
    assert.equal(calls, 1)
  }
  for (const [published, error] of [[{ status: 1 }, /PUBLISH_FAILED_GITHUB_RELEASE_RETAINED/], [{ status: 0 }, /digest mismatch/]]) {
    const calls = []
    await assert.rejects(() => publishArtifact(artifact, (_command, args) => {
      calls.push(args[0])
      if (calls.length === 1) return { status: 1, stdout: '{"error":{"code":"E404"}}' }
      if (args[0] === 'publish') return published
      return { status: 0, stdout: '"sha512-different"' }
    }), error)
    assert.deepEqual(calls, published.status ? ['view', 'publish'] : ['view', 'publish', 'view'])
  }
})
test('successful publication waits for registry processing and never repeats publish', async () => {
  const artifact = { report: { name: '@stark-lin/jab', version: '0.1.0-main.4.gbbbbbbb' }, path: '/verified/jab.tgz', integrity: 'sha512-verified' }
  const commands = [], waits = []
  let lookups = 0, elapsed = 0
  await publishArtifact(artifact, (command, args, options) => {
    assert.equal(command, 'npm')
    commands.push(args[0])
    if (args[0] === 'publish') return { status: 0 }
    assert.deepEqual(args, lookupArgs(artifact.report.version))
    assert.equal(options.timeout, 15000)
    lookups++
    return lookups < 4 ? { status: 1, stdout: '{"error":{"code":"E404"}}' } : { status: 0, stdout: JSON.stringify(artifact.integrity) }
  }, { now: () => elapsed, wait: async ms => { waits.push(ms); elapsed += ms } })
  assert.deepEqual(commands, ['view', 'publish', 'view', 'view', 'view'])
  assert.deepEqual(waits, [10000, 10000])
})
test('registry processing times out with actionable diagnostics without republishing or retagging', async t => {
  t.mock.method(console, 'log', () => {})
  const artifact = { report: { name: '@stark-lin/jab', version: '0.1.0-main.4.gbbbbbbb' }, path: '/verified/jab.tgz', integrity: 'sha512-verified' }
  const commands = []
  let elapsed = 0
  await assert.rejects(() => publishArtifact(artifact, (_command, args) => {
    commands.push(args[0])
    return args[0] === 'publish' ? { status: 0 } : { status: 1, stdout: '{"error":{"code":"E404"}}' }
  }, { now: () => elapsed, wait: async ms => { elapsed += ms } }), /NPM_REGISTRY_PROPAGATION_TIMEOUT:.*same verified artifact/)
  assert.equal(elapsed, 300000)
  assert.equal(commands.filter(command => command === 'publish').length, 1)
  assert(commands.every(command => ['view', 'publish'].includes(command)))
})
test('post-publication integrity mismatch and registry failures remain fatal after propagation delay', async () => {
  const artifact = { report: { name: '@stark-lin/jab', version: '0.1.0-main.4.gbbbbbbb' }, path: '/verified/jab.tgz', integrity: 'sha512-verified' }
  for (const [failure, expected] of [
    [{ status: 0, stdout: '"sha512-different"' }, /digest mismatch/],
    [{ status: 1, stdout: '{"error":{"code":"E401"}}' }, /LOOKUP_FAILED/],
    [{ status: 1, stdout: '{"error":{"code":"E403"}}' }, /LOOKUP_FAILED/],
    [{ status: 1, stderr: 'network down' }, /LOOKUP_FAILED/],
    [{ status: 0, stdout: '{}' }, /INTEGRITY_MISSING/],
    [{ status: 0, stdout: 'not json' }, /JSON/]
  ]) {
    const commands = [], waits = []
    let lookups = 0, elapsed = 0
    await assert.rejects(() => publishArtifact(artifact, (_command, args) => {
      commands.push(args[0])
      if (args[0] === 'publish') return { status: 0 }
      return ++lookups < 3 ? { status: 1, stdout: '{"error":{"code":"E404"}}' } : failure
    }, { now: () => elapsed, wait: async ms => { waits.push(ms); elapsed += ms } }), expected)
    assert.deepEqual(commands, ['view', 'publish', 'view', 'view'])
    assert.deepEqual(waits, [10000])
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
