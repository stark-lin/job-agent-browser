const { spawnSync } = require('node:child_process')
const { readdirSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')

// Tests use Electron's embedded Node/SQLite, matching production without native addon rebuilds.
const root = resolve(__dirname, '..')
const electron = require('electron')
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
function run(args) {
  const result = spawnSync(electron, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error || result.status !== 0) process.exit(result.status ?? 1)
}
rmSync(join(root, '.cache/tests'), { recursive: true, force: true })
run([join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.test.json'])
const tests = readdirSync(join(root, '.cache/tests/tests')).filter((name) => name.endsWith('.test.js')).map((name) => join(root, '.cache/tests/tests', name))
if (tests.length === 0) throw new Error('No tests discovered')
run(['--test', '--test-concurrency=1', ...tests])
