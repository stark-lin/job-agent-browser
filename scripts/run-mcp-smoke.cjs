const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const { dependencies } = require('../package.json')

async function main() {
  // Bundle the actual Main composition modules with production's CJS/external dependency boundary.
  const { build } = await import('vite')
  await build({ configFile: false, logLevel: 'warn', build: {
    ssr: resolve(__dirname, '../tests/mcp-runtime-smoke.ts'), outDir: resolve(__dirname, '../.cache/mcp-smoke'), emptyOutDir: true,
    rollupOptions: { external: id => id.startsWith('node:') || Object.keys(dependencies).some(name => id === name || id.startsWith(name + '/')),
      output: { format: 'cjs', entryFileNames: 'runtime.cjs' } }
  } })
  const result = spawnSync(require('electron'), [resolve(__dirname, '../.cache/mcp-smoke/runtime.cjs')], {
    cwd: resolve(__dirname, '..'), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', timeout: 30000
  })
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
}
void main().catch(() => { console.error('Unable to build MCP runtime smoke.'); process.exitCode = 1 })
