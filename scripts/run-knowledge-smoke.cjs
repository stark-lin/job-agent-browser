const { spawnSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { resolve } = require('node:path')
const { tmpdir } = require('node:os')
const directory = mkdtempSync(resolve(tmpdir(), 'jab-knowledge-smoke-')),
  env = { ...process.env, JOB_BROWSER_SMOKE_DATA: directory, JAB_MODEL_STORE: resolve(directory, 'managed-models') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
delete env.JOB_BROWSER_USER_DATA
try {
  for (const stage of ['initial', 'restart']) {
    const result = spawnSync(require('electron'), [resolve(__dirname, 'knowledge-smoke.cjs')], {
      env: { ...env, KNOWLEDGE_SMOKE_STAGE: stage },
      stdio: 'inherit',
      timeout: 60000
    })
    if (result.status !== 0) process.exitCode = result.status ?? 1
    if (process.exitCode) break
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
}
