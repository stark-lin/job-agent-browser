const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
// Local packaging never discovers personal signing identities implicitly.
const result = spawnSync(process.execPath, [resolve(__dirname, '../node_modules/electron-builder/out/cli/cli.js'), '--config', 'electron-builder.full.yml', '--publish', 'never', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false' }
})
if (result.error) console.error(result.error.message)
process.exitCode = result.status ?? 1
