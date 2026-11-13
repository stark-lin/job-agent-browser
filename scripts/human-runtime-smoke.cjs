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
    const controller = new AbortController(), { signal } = controller
    const evaluate = async code => {
      const result = await window.webContents.executeJavaScript(`(async () => {
        try { return { ok: true, value: await (${code}) } }
        catch (error) { return { ok: false, error: String(error) } }
      })()`)
      if (!result.ok) throw new Error(`Human Ask renderer evaluation failed: ${result.error}\n${code}`)
      return result.value
    }
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
      const call = async (name, input) => {
        const result = await client.callTool(name, input, signal)
        assert(!result.isError, `${name} failed: ${JSON.stringify(result.content)}`)
        return result.structuredContent
      }
      const { runId: executionRunId } = await call('run.begin', {})
      const prompt = async (question, options, interact) => {
        const dialog = `[...document.querySelectorAll('dialog[open]')].find(dialog =>
          document.getElementById(dialog.getAttribute('aria-describedby'))?.textContent === ${JSON.stringify(question)})`
        const button = label => `[...(${dialog}?.querySelectorAll('button') ?? [])].find(button => button.textContent === ${JSON.stringify(label)})`
        const [result] = await Promise.all([
          call('human.ask', { executionRunId, question, ...(options ? { options } : {}) }),
          (async () => {
            await waitFor(() => evaluate(`Boolean(${dialog})`), `Human Ask dialog for ${question}`)
            assert(!native.getVisible())
            await interact(dialog, button)
          })()
        ])
        await waitFor(() => evaluate(`!(${dialog})`), `Human Ask dialog closed for ${question}`)
        await waitFor(() => !native.webContents.isDestroyed() && native.getVisible(), 'native view restored')
        return result
      }
      const ask = async (question, options, text, selectedOption) => {
        const result = await prompt(question, options, async (dialog, button) => {
          const submit = button('Submit')
          assert(await evaluate(`!!${dialog}?.querySelector('textarea')`))
          assert.equal(await evaluate(`(${submit})?.disabled`), true)
          if (selectedOption) await evaluate(`[...${dialog}.querySelectorAll('label')].find(label => label.textContent === ${JSON.stringify(selectedOption)}).querySelector('input').click()`)
          if (text) await evaluate(`(() => { const field = ${dialog}.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)}); field.dispatchEvent(new Event('input', { bubbles: true })) })()`)
          await waitFor(() => evaluate(`(${submit})?.disabled === false`), 'answer enables Submit')
          await evaluate(`(${submit}).click()`)
        })
        assert.deepEqual(result, { status: 'submitted', selectedOption, text })
        assert.equal(native.webContents.id, nativeId)
        assert.equal(await native.webContents.executeJavaScript('document.querySelector("#draft").value'), 'Keep my draft')
      }
      await ask('Which direction?', ['Backend', 'Full stack'], 'Prefer APIs', 'Backend')
      await ask('What else should we know?', [], 'Text only', null)
      const cancelled = await prompt('Cancel this?', undefined, (_dialog, button) => evaluate(`(${button('Cancel')}).click()`))
      assert.deepEqual(cancelled, { status: 'cancelled' })
      session.fromPartition('persist:job-agent-browser').webRequest.onBeforeRequest({ urls: ['https://human.fixture.invalid/*'] }, (_details, callback) => callback({ redirectURL: url + '/inbox' }))
      assert((await evaluate("window.data.settings.savePreferences({ mailbox: { provider: 'custom', url: 'https://human.fixture.invalid/inbox' } })")).ok)
      await evaluate("window.browser.navigate('app://inbox')")
      await waitFor(() => views(window).some(view => view.webContents.getURL() === url + '/inbox' && view.getVisible()), 'native Inbox visible')
      native = views(window).find(view => view.webContents.getURL() === url + '/inbox'); nativeId = native.webContents.id
      await ask('Which Inbox option?', ['Inbox option'], '', 'Inbox option')
      await call('run.end', { runId: executionRunId })
      await client.close(); server.closeAllConnections(); server.close()
      console.log('Human Ask smoke passed: real external MCP, trusted IPC, options/text/cancel, disabled empty submit and Browser/Inbox native view and draft restoration.')
      app.once('will-quit', () => { clearTimeout(watchdog); app.exit(0) }); app.quit()
    } catch (error) {
      console.error(error); controller.abort(); await client?.close(); server?.closeAllConnections(); server?.close(); clearTimeout(watchdog); app.exit(1)
    }
  })
})
require(resolve(__dirname, '../out/main/index.js'))
