const { spawnSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const directory = mkdtempSync(join(tmpdir(), 'jab-model-ui-'))
const store = join(directory, 'managed-models')
mkdirSync(store)
writeFileSync(join(store, 'seed-preferences.json'), JSON.stringify({ autoImportSeed: false, seedInitializedRevisions: [] }))
mkdirSync(resolve(__dirname, '../.cache/model-smoke'), { recursive: true })
const env = { ...process.env, JOB_BROWSER_SMOKE_DATA: directory, JAB_MODEL_STORE: store,
  JAB_MODEL_SMOKE_APP: resolve(__dirname, '..'), JAB_MODEL_SMOKE_SEED: resolve(__dirname, '../.cache/models/multilingual-e5-small'),
  JAB_MODEL_SMOKE_CAPTURE: resolve(__dirname, '../.cache/model-smoke/settings.png') }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.JOB_BROWSER_USER_DATA
try {
  const result = spawnSync(require('electron'), [join(__dirname, 'model-runtime-smoke.cjs')], { env, stdio: 'inherit', timeout: 180000 })
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
} finally { rmSync(directory, { recursive: true, force: true }) }
