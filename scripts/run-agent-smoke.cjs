const { spawnSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, join } = require('node:path')
const directory = mkdtempSync(join(tmpdir(), 'resume-v1-smoke-'))
const env = { ...process.env, JOB_BROWSER_SMOKE_DATA: directory, JAB_MODEL_STORE: join(directory, 'managed-models') }
delete env.JOB_BROWSER_USER_DATA
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
const suites = process.argv.includes('--output') ? ['resume-output-smoke.cjs'] : process.argv.includes('--profile') ? ['profile-runtime-smoke.cjs'] : ['resume-runtime-smoke.cjs', 'resume-restart-smoke.cjs', 'resume-output-smoke.cjs']
try {
  for (const suite of suites) {
    const result = spawnSync(require('electron'), [resolve(__dirname, suite)], { env, stdio: 'inherit', timeout: 60000, killSignal: 'SIGKILL' })
    if (result.error) console.error(result.error.message)
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break }
  }
} finally { rmSync(directory, { recursive: true, force: true }) }
