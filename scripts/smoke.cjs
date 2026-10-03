const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { resolve } = require('node:path')

// Exercise the built production Main + sandboxed Preload + trusted HTML, using disposable data.
const storage = process.env.JOB_BROWSER_SMOKE_DATA
assert(storage, 'The smoke runner must provide disposable storage')
app.setPath('userData', storage)
const timeout = setTimeout(() => { console.error('Electron smoke timed out'); app.exit(1) }, 30_000)
let mainWindowSelected = false
app.on('browser-window-created', (_event, window) => {
  if (mainWindowSelected) return
  mainWindowSelected = true
  window.webContents.once('did-finish-load', async () => {
    try {
      const results = await window.webContents.executeJavaScript(`(async () => {
        const created = await window.data.jobs.saveJob({details:{title:'Smoke role',companyNameRaw:'Smoke company'}});
        if (!created.ok) throw new Error(created.error);
        const before = await window.data.audit.list({});
        const fetched = await window.data.jobs.getJob({id:created.value.id});
        const after = await window.data.audit.list({});
        const removed = await window.data.jobs.deleteJob({id:created.value.id});
        const missing = await window.data.jobs.getJob({id:created.value.id});
        return {created,fetched,before,after,removed,missing,auditMethods:Object.keys(window.data.audit),generatorExposed:!!window.data.generation};
      })()`)
      assert.equal(results.fetched.value.title, 'Smoke role')
      assert.equal(results.before.value.total, 1)
      assert.equal(results.after.value.total, 1)
      assert.equal(results.removed.ok, true)
      assert.equal(results.missing.error, 'NOT_FOUND')
      assert.deepEqual(results.auditMethods, ['list'])
      assert.equal(results.generatorExposed, false)
      // A different document in a window still fails the real Main IPC sender check.
      const outsider = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
      await outsider.loadURL('data:text/html,<h1>Untrusted smoke document</h1>')
      const denied = await outsider.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('data:call','jobs','listJobs',{})")
      assert.deepEqual(denied, { ok: false, error: 'FORBIDDEN' })
      outsider.destroy()
      console.log('Electron smoke passed: production startup, sandboxed bridge, automatic audit, read semantics, deletion and rejected untrusted document.')
      // Main's earlier will-quit listener closes SQLite first. Avoid waiting on Chromium helpers.
      app.once('will-quit', () => { clearTimeout(timeout); app.exit(0) })
      app.quit()
    } catch (error) {
      clearTimeout(timeout)
      console.error(error)
      app.exit(1)
    }
  })
})
require(resolve(__dirname, '../out/main/index.js'))
