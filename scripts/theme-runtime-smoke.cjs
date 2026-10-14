const { app, nativeTheme } = require('electron')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

assert(process.env.JOB_BROWSER_SMOKE_DATA, 'Theme runner requires disposable storage')
app.setPath('userData', process.env.JOB_BROWSER_SMOKE_DATA)
const timeout = setTimeout(() => { console.error('Theme smoke timed out'); app.exit(1) }, 30_000)
app.once('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html'); response.end('<title>Theme fixture</title><h1>Website appearance</h1>')
    })
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const origin = `http://127.0.0.1:${server.address().port}`
      const evaluate = code => window.webContents.executeJavaScript(`(async () => (${code}))()`)
      const call = (method, ...args) => evaluate(`window.browser.${method}(${args.map(arg => JSON.stringify(arg)).join(',')})`)
      const read = () => call('getState')
      const active = state => state.tabs.find(tab => tab.id === state.activeTabId)
      const waitFor = async (check, label) => {
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
          if (await check()) return
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        throw new Error(`Timed out: ${label}`)
      }
      const waitState = (check, label) => waitFor(async () => check(await read()), label)
      const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const formsReady = () => waitFor(() => evaluate('document.querySelectorAll(".settings-page form:not([data-audit-filters])").length === 4'), 'theme Settings forms')
      const field = async (selector, value, type) => {
        await evaluate(`(() => {
          const input = document.querySelector(${JSON.stringify(selector)});
          Object.getOwnPropertyDescriptor(${type === 'select' ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype, 'value').set.call(input, ${JSON.stringify(value)});
          input.dispatchEvent(new Event(${JSON.stringify(type === 'select' ? 'change' : 'input')}, { bubbles: true }));
        })()`)
        await frames()
      }
      const data = (group, method, input) => evaluate(`window.data.${group}.${method}(${JSON.stringify(input)})`)
      const capture = async name => {
        await frames(); mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
        writeFileSync(resolve(__dirname, '../.cache', name), (await window.capturePage()).toPNG())
      }
      await call('navigate', 'app://settings'); await formsReady()
      await require('./theme-smoke.cjs')({ window, call, read, active, evaluate, waitFor, waitState,
        views: () => window.contentView.children.filter(view => view.webContents), origin, field,
        submit: index => evaluate(`document.querySelectorAll('.settings-page form:not([data-audit-filters])')[${index}].requestSubmit()`), formsReady, capture, data })
      await data('settings', 'savePreferences', { language: 'zh-CN', theme: 'dark', mailbox: { provider: 'custom', url: 'https://example.invalid/mail' } })
      const status = (await data('secrets', 'hasProviderKey', { provider: 'openai' })).value
      if (status.available) await data('secrets', 'saveProviderKey', { provider: 'openai', apiKey: 'smoke-key-restart' })
      if (process.platform === 'darwin') {
        const listeners = nativeTheme.listenerCount('updated')
        // macOS keeps the app alive after its final window closes; activation recreates it.
        const recreated = new Promise(resolve => app.once('browser-window-created', (_event, next) => resolve(next)))
        window.destroy()
        assert.equal(nativeTheme.listenerCount('updated'), listeners - 1, 'Disposed window releases theme listener')
        app.emit('activate')
        const next = await recreated
        assert.equal(next.getBackgroundColor().toLowerCase(), '#18181b', 'Recreated native window starts dark')
        await new Promise(resolve => next.webContents.once('did-finish-load', resolve))
        await waitFor(() => next.webContents.executeJavaScript("document.documentElement.dataset.theme === 'dark'"), 'recreated renderer dark')
      }
      app.once('will-quit', () => { clearTimeout(timeout); app.exit(0) })
      app.quit()
    } catch (error) { clearTimeout(timeout); console.error(error); app.exit(1) }
    finally { server.closeAllConnections(); server.close() }
  })
})
require(resolve(__dirname, '../out/main/index.js'))
