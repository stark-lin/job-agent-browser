const { app } = require('electron')
const assert = require('node:assert/strict')
const { resolve } = require('node:path')
assert(process.env.JOB_BROWSER_SMOKE_DATA, 'Job runner requires disposable storage')
app.setPath('userData', process.env.JOB_BROWSER_SMOKE_DATA)
const timeout = setTimeout(() => { console.error('Job smoke timed out'); app.exit(1) }, 30_000)
app.once('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    const evaluate = async code => {
      try { return await window.webContents.executeJavaScript(`(async () => (${code}))()`) }
      catch (error) { throw new Error(`${error.message}\nExpression: ${code}`) }
    }
    const call = (method, ...args) => evaluate(`window.browser.${method}(${args.map(arg => JSON.stringify(arg)).join(',')})`)
    const read = () => call('getState'), active = state => state.tabs.find(tab => tab.id === state.activeTabId)
    const waitFor = async (check, label) => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 20)) }
      throw new Error(`Timed out: ${label}`)
    }
    try {
      if (process.env.JOB_BROWSER_VERIFY_RESTART) {
        const result = await evaluate('window.data.jobs.listJobs({search:"Keep manual title"})')
        assert(result.ok); assert.equal(result.value.total, 1)
        const job = result.value.items[0]
        assert.equal(job.applicationStatus, 'NOT_STARTED'); assert.equal(job.appliedAt, null)
        assert.equal((await evaluate(`window.data.jobs.listSources({jobId:${JSON.stringify(job.id)}})`)).value.total, 1)
        await call('navigate', 'app://applications')
        await waitFor(() => evaluate('document.querySelectorAll("tbody tr").length === 25'), 'jobs after process restart')
        console.log('Job restart smoke passed: saved fields, NOT_STARTED status, source and list persist in a fresh process.')
      } else await require('./job-smoke.cjs')({ window, call, read, active, evaluate, waitFor })
      app.once('will-quit', () => { clearTimeout(timeout); app.exit(0) }); app.quit()
    } catch (error) { clearTimeout(timeout); console.error(error); app.exit(1) }
  })
})
require(resolve(__dirname, '../out/main/index.js'))
