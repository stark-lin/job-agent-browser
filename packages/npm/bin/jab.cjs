#!/usr/bin/env node
const { spawn } = require('node:child_process')
const { realpathSync } = require('node:fs')
const { join, resolve, isAbsolute } = require('node:path')
const root = resolve(__dirname, '..')
function parse(args) {
  let directory = process.env.JOB_BROWSER_USER_DATA
  const rest = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir') {
      directory = args[++i]
      if (!directory) throw new Error('--data-dir requires an absolute path')
    } else rest.push(args[i])
  }
  if (directory && !isAbsolute(directory)) throw new Error('Data directory must be absolute')
  return { directory, rest }
}
function run(command, args, env) {
  const child = spawn(command, args, { stdio: 'inherit', env })
  const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => child.kill(signal)]))
  for (const [signal, handler] of handlers) process.on(signal, handler)
  child.once('error', error => { console.error(error.message); process.exitCode = 1 })
  child.once('close', code => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler)
    process.exitCode = code ?? 1
  })
}
async function main() {
  const metadata = require('../package.json')
  const { directory, rest } = parse(process.argv.slice(2))
  if (rest.length === 1 && ['--version', '-v'].includes(rest[0])) { console.log(metadata.version); return }
  if (rest.length === 1 && ['--help', '-h'].includes(rest[0])) {
    console.log('jab [--data-dir <absolute path>]\njab --version\njab doctor\njab mcp --data-dir <absolute path>'); return
  }
  if (rest[0] === 'doctor') {
    if (rest.length > 1) throw new Error('Unknown doctor option')
    await require('./doctor.cjs').doctor(root, directory); return
  }
  const env = { ...process.env, JAB_DISTRIBUTION: 'npm' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  if (directory) env.JOB_BROWSER_USER_DATA = directory
  if (rest[0] === 'mcp') {
    if (rest.length !== 1) throw new Error('Unknown MCP option')
    if (!directory) throw new Error('MCP requires --data-dir or JOB_BROWSER_USER_DATA')
    // Resolve via Electron's official module only when PDF rendering needs a runtime.
    // Protocol stdout must remain free of Electron's first-download messages.
    run(process.execPath, [join(root, 'out/main/job-agent-mcp.js')], env); return
  }
  if (rest.some(arg => !['--verify-package', '--verify-minimal'].includes(arg))) throw new Error('Unknown command; use jab --help')
  if (rest.includes('--verify-minimal') && !rest.includes('--verify-package')) throw new Error('--verify-minimal requires --verify-package')
  if (rest.includes('--verify-package') && !directory) throw new Error('Verification requires an explicit --data-dir')
  env.JAB_NPM_CLI = realpathSync(__filename)
  env.JAB_NODE_EXECUTABLE = process.execPath
  env.JAB_NPM_EPHEMERAL = /(?:^|[/\\])_npx(?:[/\\]|$)/.test(root) ? '1' : '0'
  run(process.execPath, [require.resolve('electron/cli.js'), root, ...rest], env)
}
if (require.main === module) {
  void main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
module.exports = { parse, main }
