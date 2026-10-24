const { app } = require('electron')
const { mkdirSync } = require('node:fs')
const { resolve } = require('node:path')

// Redirect every Agent configuration path before loading production Main.
module.exports = function externalMCPTestHome(directory) {
  const home = resolve(directory, 'agent-home')
  mkdirSync(home, { recursive: true })
  app.setPath('home', home)
  process.env.CODEX_HOME = resolve(home, '.codex')
}
