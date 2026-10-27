const { join, resolve } = require('node:path')
const core = require('../src/platform/models/core.cjs')
const manifest = require('../resources/embedding-model.json')
const root = resolve(__dirname, '..')
const prepare = (options = {}) => core.prepare({ directory: join(root, '.cache/models', manifest.id), model: manifest, ...options })
module.exports = { ...core, prepare }
if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--verify')) throw new Error('Unknown model option')
  prepare({ verify: args.includes('--verify') }).then(() => console.log('Model files verified: ' + manifest.revision)).catch(e => { console.error(e.message); process.exitCode = 1 })
}
