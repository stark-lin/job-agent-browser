const assert = require('node:assert/strict')
const { readdirSync, lstatSync, readFileSync, existsSync, mkdirSync, writeFileSync } = require('node:fs')
const { resolve, join, relative } = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const root = resolve(__dirname, '..')
const digest = data => createHash('sha256').update(data).digest('hex')
function verify(directory = join(root, 'dist/npm')) {
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json')))
  assert.equal(pkg.name, '@stark-lin/jab'); assert.equal(pkg.license, 'AGPL-3.0-only')
  assert.equal(pkg.private, undefined); assert.equal(pkg.scripts, undefined)
  assert.equal(pkg.dependencies.electron, require('../package-lock.json').packages['node_modules/electron'].version)
  for (const version of Object.values(pkg.dependencies)) assert(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version), 'Dependencies must be exact')
  const lock = JSON.parse(readFileSync(join(directory, 'npm-shrinkwrap.json')))
  assert.equal(lock.version, pkg.version); assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies)
  function walk(path) {
    for (const item of readdirSync(path)) {
      const child = join(path, item), info = lstatSync(child), name = relative(directory, child).replaceAll('\\', '/')
      assert(!info.isSymbolicLink(), 'Symlink forbidden: ' + name)
      assert(!/(?:^|\/)(?:node_modules|\.cache|\.env[^/]*|\.git|fixtures?|database\.sqlite|secrets\.enc)(?:\/|$)|\.(?:onnx|dmg|exe|AppImage|tmp|sqlite|db|pem|p8|key)$/i.test(name), 'Forbidden file: ' + name)
      assert(/^(?:package\.json|npm-shrinkwrap\.json|LICENSE|README(?:\.zh-CN)?\.md|(?:bin|out|resources)\/)/.test(name) || ['bin', 'out', 'resources'].includes(name), 'Unexpected package entry: ' + name)
      if (info.isDirectory()) walk(child)
    }
  }
  walk(directory)
  for (const name of ['out/main/index.js', 'out/main/job-agent-mcp.js', 'out/main/resume-output-worker.js', 'out/main/embedding-process.js', 'out/main/pdf-worker.mjs', 'out/main/fonts/NotoSansSC.ttf', 'out/main/skills', 'out/preload/index.js', 'out/renderer/index.html', 'resources/embedding-model.json', 'resources/model-notice.txt']) assert(existsSync(join(directory, name)), 'Missing resource: ' + name)
  const destination = join(root, 'dist/npm-artifacts'); mkdirSync(destination, { recursive: true })
  const pack = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], { cwd: directory, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(root, '.cache/npm-pack') } })
  assert.equal(pack.status, 0, pack.stderr)
  const result = JSON.parse(pack.stdout)[0], tarball = join(destination, result.filename)
  const packed = new Set(result.files.map(f => f.path))
  assert(packed.has('npm-shrinkwrap.json') && packed.has('LICENSE'))
  assert.equal(packed.size, result.files.length)
  writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ name: pkg.name, version: pkg.version, sha: pkg.jab.gitSha,
    tarball: result.filename, size: readFileSync(tarball).length, sha256: digest(readFileSync(tarball)), integrity: result.integrity,
    runtimeVerified: false, modelRevision: pkg.jab.modelRevision }, null, 2) + '\n')
  console.log(`Verified model-free npm tarball: ${tarball}`)
  return tarball
}
module.exports = { verify }
if (require.main === module) verify()
