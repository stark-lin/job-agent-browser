const { existsSync, readFileSync, accessSync, constants, lstatSync, createReadStream } = require('node:fs')
const { join, dirname, isAbsolute } = require('node:path')
const { homedir } = require('node:os')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
async function verifyModel(directory, manifest) {
  if (!existsSync(directory)) return 'missing'
  try {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) return 'corrupted'
    for (const file of manifest.files) {
      let path = directory
      for (const part of file.path.split('/')) {
        path = join(path, part)
        if (lstatSync(path).isSymbolicLink()) return 'corrupted'
      }
      const info = lstatSync(path)
      if (!info.isFile() || info.size !== file.size) return 'corrupted'
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      if (hash.digest('hex') !== file.sha256) return 'corrupted'
    }
    return 'ready'
  } catch { return 'corrupted' }
}
async function doctor(root, directory) {
  let runtime, runtimeError
  const pkg = require(join(root, 'package.json'))
  try {
    const base = dirname(require.resolve('electron/package.json', { paths: [root] }))
    runtime = join(base, 'dist', readFileSync(join(base, 'path.txt'), 'utf8').trim())
    accessSync(runtime, constants.X_OK)
    if (!lstatSync(runtime).isFile()) throw new Error()
    const probe = spawnSync(runtime, ['-p', 'process.versions.electron'], { encoding: 'utf8', timeout: 10000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    if (probe.status !== 0 || probe.stdout.trim() !== pkg.dependencies.electron) throw new Error()
  } catch { runtime = null; runtimeError = 'Electron executable unavailable or wrong version. Run jab to initialize the official runtime.' }
  const home = homedir()
  const models = process.env.JAB_MODEL_STORE || (process.platform === 'darwin' ? join(home, 'Library/Application Support/JAB/managed-models') : process.platform === 'win32' ? join((process.env.LOCALAPPDATA && isAbsolute(process.env.LOCALAPPDATA) ? process.env.LOCALAPPDATA : join(home, 'AppData/Local')), 'JAB/Models') : join((process.env.XDG_DATA_HOME && isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : join(home, '.local/share')), 'JAB/models'))
  const manifest = require(join(root, 'resources/embedding-model.json'))
  const modelDirectory = join(models, manifest.id, manifest.revision)
  const modelState = await verifyModel(modelDirectory, manifest)
  const mcp = existsSync(join(root, 'out/main/job-agent-mcp.js'))
  console.log(JSON.stringify({ version: pkg.version, platform: process.platform, arch: process.arch,
    supported: process.platform === 'darwin' && process.arch === 'arm64', node: process.versions.node,
    electron: { executable: runtime, error: runtimeError }, mcp, dataDirectory: directory || 'GUI default: JAB in the OS application data directory; MCP requires explicit data directory',
    model: { directory: modelDirectory, state: modelState, integrity: modelState === 'ready' ? 'SHA256 verified' : 'Optional model unavailable; keyword retrieval remains available' } }, null, 2))
  if (!runtime || !mcp || modelState === 'corrupted') process.exitCode = 1
}
module.exports = { doctor, verifyModel }
