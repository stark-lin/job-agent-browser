const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
env.JOB_BROWSER_SMOKE_DATA = mkdtempSync(resolve(tmpdir(), 'job-browser-smoke-'))
const child = spawnSync(require('electron'), [resolve(__dirname, 'smoke.cjs')], { env, stdio: 'inherit', timeout: 40_000, killSignal: 'SIGKILL' })
rmSync(env.JOB_BROWSER_SMOKE_DATA, { recursive: true, force: true })
if (child.error) console.error(child.error.message)
if (child.status !== 0) console.error(`Electron smoke exited: status=${child.status}, signal=${child.signal}`)
process.exit(child.status ?? 1)
