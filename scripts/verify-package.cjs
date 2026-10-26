const assert = require('node:assert/strict')
const { join, resolve } = require('node:path')
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, lstatSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const { prepare } = require('./prepare-embedding-model.cjs')
const manifest = require('../resources/embedding-model.json')
async function main() {
  const supplied = process.argv[2]
  assert(supplied, 'Usage: node scripts/verify-package.cjs <unpacked app directory>')
  const app = resolve(supplied)
  const resources = process.platform === 'darwin' ? join(app, 'Contents/Resources') : join(app, 'resources')
  const executable = process.platform === 'darwin' ? join(app, 'Contents/MacOS/JAB') : join(app, process.platform === 'win32' ? 'JAB.exe' : 'jab')
  assert(existsSync(executable), 'Missing packaged executable: ' + executable)
  assert(existsSync(join(resources, 'app.asar')), 'Missing ASAR')
  assert.deepEqual(JSON.parse(readFileSync(join(resources, 'embedding-model.json'), 'utf8')), manifest)
  assert(existsSync(join(resources, 'model-notice.txt')), 'Missing model notice')
  await prepare({ directory: join(resources, 'models', manifest.id), verify: true })
  function find(directory, name) {
    if (!existsSync(directory)) return false
    return readdirSync(directory).some(entry => {
      const path = join(directory, entry)
      return entry === name || lstatSync(path).isDirectory() && find(path, name)
    })
  }
  assert(find(join(resources, 'app.asar.unpacked/node_modules/onnxruntime-node'), 'onnxruntime_binding.node'), 'Missing unpacked ONNX runtime')
  const directory = mkdtempSync(join(tmpdir(), 'jab-package-check-'))
  const env = { ...process.env, JOB_BROWSER_USER_DATA: directory }
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  try {
    const result = spawnSync(executable, ['--verify-package'], { env, stdio: 'inherit', cwd: tmpdir(), timeout: 180000 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, 'Packaged runtime failed')
    const report = JSON.parse(readFileSync(join(directory, 'package-verification.json'), 'utf8'))
    assert(report.ok && report.pdfVerified && report.dimensions === 384 && report.forks === 1)
    assert.equal(report.arch, process.arch, 'Verification must run on the target architecture')
    console.log('Package verified:', JSON.stringify(report))
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
void main().catch(e => { console.error(e); process.exitCode = 1 })
