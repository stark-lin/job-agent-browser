const { spawnSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
async function main() {
  const root = resolve(__dirname, '..'), output = join(root, '.cache/embedding-smoke')
  const { build } = await import('vite')
  const { dependencies } = require('../package.json')
  await build({ configFile: false, logLevel: 'warn', build: { ssr: join(root, 'src/platform/electron/package-verification.ts'), outDir: output,
    rollupOptions: { external: id => id === 'electron' || id.startsWith('node:') || Object.keys(dependencies).some(name => id === name || id.startsWith(name + '/')),
      output: { format: 'cjs', entryFileNames: 'verification.cjs' } } } })
  const directory = mkdtempSync(join(tmpdir(), 'jab-embedding-'))
  const env = { ...process.env, JAB_EMBEDDING_SMOKE_DATA: directory }
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  try {
    const result = spawnSync(require('electron'), [join(__dirname, 'embedding-runtime-smoke.cjs')], { env, cwd: root, stdio: 'inherit', timeout: 180000 })
    if (result.error) console.error(result.error.message)
    process.exitCode = result.status ?? 1
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
void main().catch(e => { console.error(e); process.exitCode = 1 })
