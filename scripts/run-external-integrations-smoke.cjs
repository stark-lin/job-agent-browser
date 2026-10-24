const { resolve, join } = require('node:path')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')

if (!process.argv.includes('--runtime')) {
  const { spawnSync } = require('node:child_process')
  const directory = mkdtempSync(join(require('node:os').tmpdir(), 'job-browser-integrations-'))
  const env = { ...process.env, JOB_BROWSER_SMOKE_DATA: directory }
  delete env.JOB_BROWSER_USER_DATA
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const child = spawnSync(require('electron'), [__filename, '--runtime'], { env, stdio: 'inherit', timeout: 60_000, killSignal: 'SIGKILL' })
  rmSync(directory, { recursive: true, force: true })
  if (child.error) console.error(child.error.message)
  process.exit(child.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
assert(process.env.JOB_BROWSER_SMOKE_DATA, 'Integration smoke requires disposable data')
app.setPath('userData', process.env.JOB_BROWSER_SMOKE_DATA)
require('./external-mcp-test-home.cjs')(process.env.JOB_BROWSER_SMOKE_DATA)
const timeout = setTimeout(() => { console.error('Integration smoke timed out'); app.exit(1) }, 55_000)
app.once('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    const evaluate = script => window.webContents.executeJavaScript(script)
    const waitFor = async (check, label) => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if (await check()) return
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      throw new Error(`Timed out: ${label}`)
    }
    const data = (group, method, input) => evaluate(`window.data.${group}.${method}(${JSON.stringify(input)})`)
    const capture = async name => {
      mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      writeFileSync(resolve(__dirname, '../.cache', name), (await window.capturePage()).toPNG())
    }
    try {
      await evaluate("window.browser.navigate('app://settings')")
      await require('./external-mcp-smoke.cjs')({ window, evaluate, waitFor, data, capture })
      const outsider = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
      await outsider.loadURL('data:text/html,<h1>Untrusted integration smoke</h1>')
      for (const channel of ['external-mcp:call', 'external-skills:call']) for (const method of ['reconnect', 'remove']) {
        assert.deepEqual(await outsider.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke(${JSON.stringify(channel)},${JSON.stringify(method)},{})`), { ok: false, error: 'FORBIDDEN' })
      }
      outsider.destroy()
      console.log('External integration runtime smoke passed, including untrusted-frame rejection and bilingual light/dark layouts at 320/640/1200px.')
      app.once('will-quit', () => { clearTimeout(timeout); app.exit(0) })
      app.quit()
    } catch (error) { clearTimeout(timeout); console.error(error); app.exit(1) }
  })
})
require(resolve(__dirname, '../out/main/index.js'))
