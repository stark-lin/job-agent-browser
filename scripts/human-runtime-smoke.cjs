const { app, BrowserWindow, session } = require('electron')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { resolve } = require('node:path')
const { createMCPClient } = require('../.cache/tests/src/platform/mcp/client.js')
const { views } = require('./native-views.cjs')
const directory = process.env.JOB_BROWSER_SMOKE_DATA
assert(directory)
app.setPath('userData', directory)
const watchdog = setTimeout(() => { console.error('Human Ask smoke timed out'); app.exit(1) }, 45000)
let selected = false
app.on('browser-window-created', (_event, window) => {
  if (selected) return
  selected = true
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    let client, server
    const evaluate = code => window.webContents.executeJavaScript(code)
    const waitFor = async (condition, label) => { const end = Date.now() + 8000; while (!await condition()) { if (Date.now() > end) throw new Error(label); await new Promise(r => setTimeout(r, 20)) } }
    try {
      await require('./complete-onboarding.cjs')(window)
      server = createServer((_request, response) => response.end('<title>Human Ask page</title><input id="draft" value="Keep my draft">'))
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const url = `http://127.0.0.1:${server.address().port}/human`
      await evaluate(`window.browser.navigate(${JSON.stringify(url)})`)
      await waitFor(() => views(window).some(view => view.webContents.getURL() === url && view.getVisible()), 'native Browser visible')
      let native = views(window).find(view => view.webContents.getURL() === url), nativeId = native.webContents.id
      assert.equal(await native.webContents.executeJavaScript('typeof window.human'), 'undefined')
      client = createMCPClient({ id: 'human-smoke', enabled: true, transport: 'stdio', command: process.execPath, args: [resolve(__dirname, '../out/main/job-agent-mcp.js')], tools: [] }, { closed() {}, changed() {} }, { processEnv: { JOB_BROWSER_USER_DATA: directory, ELECTRON_RUN_AS_NODE: '1' } })
      await client.connect()
      const signal = new AbortController().signal
      const begin = await client.callTool('run.begin', {}, signal), executionRunId = begin.structuredContent.runId
      const ask = async (options, text, selectedOption) => {
        const pending = client.callTool('human.ask', { executionRunId, question: 'Which direction?', ...(options ? { options } : {}) }, signal)
        await waitFor(() => evaluate('!!document.querySelector("dialog[open]")'), 'global Human Ask dialog')
        assert(!native.getVisible())
        assert(await evaluate('!!document.querySelector("dialog[open] textarea")'))
        assert(await evaluate('[...document.querySelectorAll("dialog[open] button")].find(button => button.textContent === "Submit").disabled'))
        if (selectedOption) await evaluate(`[...document.querySelectorAll('dialog[open] label')].find(label => label.textContent === ${JSON.stringify(selectedOption)}).querySelector('input').click()`)
        if (text) await evaluate(`(() => { const field = document.querySelector('dialog[open] textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)}); field.dispatchEvent(new Event('input', { bubbles: true })) })()`)
        await waitFor(() => evaluate('![...document.querySelectorAll("dialog[open] button")].find(button => button.textContent === "Submit").disabled'), 'answer enables Submit')
        await evaluate('[...document.querySelectorAll("dialog[open] button")].find(button => button.textContent === "Submit").click()')
        assert.deepEqual((await pending).structuredContent, { status: 'submitted', selectedOption, text })
        await waitFor(() => !native.webContents.isDestroyed() && native.getVisible(), 'native view restored')
        assert.equal(native.webContents.id, nativeId)
        assert.equal(await native.webContents.executeJavaScript('document.querySelector("#draft").value'), 'Keep my draft')
      }
      await ask(['Backend', 'Full stack'], 'Prefer APIs', 'Backend')
      await ask([], 'Text only', null)
      const cancel = client.callTool('human.ask', { executionRunId, question: 'Cancel this?' }, signal)
      await waitFor(() => evaluate('!!document.querySelector("dialog[open]")'), 'cancel dialog')
      await evaluate('[...document.querySelectorAll("dialog[open] button")].find(button => button.textContent === "Cancel").click()')
      assert.deepEqual((await cancel).structuredContent, { status: 'cancelled' })
      await waitFor(() => native.getVisible(), 'restore after cancel')
      session.fromPartition('persist:job-agent-browser').webRequest.onBeforeRequest({ urls: ['https://human.fixture.invalid/*'] }, (_details, callback) => callback({ redirectURL: url + '/inbox' }))
      assert((await evaluate("window.data.settings.savePreferences({ mailbox: { provider: 'custom', url: 'https://human.fixture.invalid/inbox' } })")).ok)
      await evaluate("window.browser.navigate('app://inbox')")
      await waitFor(() => views(window).some(view => view.webContents.getURL() === url + '/inbox' && view.getVisible()), 'native Inbox visible')
      native = views(window).find(view => view.webContents.getURL() === url + '/inbox'); nativeId = native.webContents.id
      await ask(['Inbox option'], '', 'Inbox option')
      await client.callTool('run.end', { runId: executionRunId }, signal)
      await client.close(); server.closeAllConnections(); server.close()
      console.log('Human Ask smoke passed: real external MCP, trusted IPC, options/text/cancel, disabled empty submit and Browser/Inbox native view and draft restoration.')
      app.once('will-quit', () => { clearTimeout(watchdog); app.exit(0) }); app.quit()
    } catch (error) {
      console.error(error); await client?.close(); server?.closeAllConnections(); server?.close(); clearTimeout(watchdog); app.exit(1)
    }
  })
})
require(resolve(__dirname, '../out/main/index.js'))
