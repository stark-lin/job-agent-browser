const { spawnSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve } = require('node:path')
const directory = mkdtempSync(resolve(tmpdir(), 'jab-onboarding-'))
const env = { ...process.env, JOB_BROWSER_SMOKE_DATA: directory, JAB_MODEL_STORE: resolve(directory, 'managed-models') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
delete env.JOB_BROWSER_USER_DATA
try {
  for (const stage of ['main', 'restart', 'unfinished']) {
    const result = spawnSync(require('electron'), [resolve(__dirname, 'onboarding-runtime-smoke.cjs')], {
      env: { ...env, ONBOARDING_STAGE: stage }, stdio: 'inherit', timeout: 45000, killSignal: 'SIGKILL'
    })
    if (result.error) console.error(result.error)
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break }
  }
} finally { rmSync(directory, { recursive: true, force: true }) }
