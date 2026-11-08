const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')

async function initializeElectron(cwd, env, { spawn = spawnSync, wait = delay } = {}) {
  // Retry only the official module's runtime download, never the business/runtime checks.
  // Each attempt is a new process so a failed require cannot leave cached module state.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = spawn(process.execPath, ['-e', "require('electron')"], {
      cwd, env, encoding: 'utf8', timeout: 120000
    })
    if (result.stdout) console.log(result.stdout.trimEnd())
    if (result.stderr) console.error(result.stderr.trimEnd())
    const transient = result.error?.code === 'ETIMEDOUT' ||
      /Response code (?:408|429|5\d\d)\b|\b(?:ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)\b|fetch failed/i.test(result.stderr || '')
    if ((result.error || result.status !== 0) && transient && attempt < 3) {
      const backoff = attempt * 10000
      console.error(`Electron initialization attempt ${attempt}/3 failed transiently; retrying in ${backoff / 1000}s.`)
      await wait(backoff)
      continue
    }
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, `Electron initialization failed after ${attempt} attempt(s).\n${result.stdout || ''}\n${result.stderr || ''}`)
    return
  }
}

module.exports = { initializeElectron }
if (require.main === module) {
  void initializeElectron(process.cwd(), process.env).catch(error => { console.error(error); process.exitCode = 1 })
}
