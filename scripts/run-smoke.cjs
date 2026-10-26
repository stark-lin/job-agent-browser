const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const env = { ...process.env }
delete env.JOB_BROWSER_USER_DATA
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
env.JOB_BROWSER_SMOKE_DATA = mkdtempSync(resolve(tmpdir(), 'job-browser-smoke-'))
const jobs = process.argv.includes('--jobs')
const suite = jobs ? 'job-runtime-smoke.cjs' : process.argv.includes('--theme') ? 'theme-runtime-smoke.cjs' : 'smoke.cjs'
let child = spawnSync(require('electron'), [resolve(__dirname, suite)], { env, stdio: 'inherit', timeout: 180_000, killSignal: 'SIGKILL' })
if (child.status === 0) child = spawnSync(require('electron'), [resolve(__dirname, jobs ? 'job-runtime-smoke.cjs' : 'settings-restart-smoke.cjs')], {
  env: jobs ? { ...env, JOB_BROWSER_VERIFY_RESTART: '1' } : env, stdio: 'inherit', timeout: 15_000, killSignal: 'SIGKILL'
})
rmSync(env.JOB_BROWSER_SMOKE_DATA, { recursive: true, force: true })
if (child.error) console.error(child.error.message)
if (child.status !== 0) console.error(`Electron smoke exited: status=${child.status}, signal=${child.signal}`)
process.exit(child.status ?? 1)
