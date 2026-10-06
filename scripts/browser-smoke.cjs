const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

module.exports = async function browserSmoke(window) {
  const server = createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/redirect-final' }); response.end(); return }
    if (request.url === '/failure') { response.destroy(); return }
    const respond = () => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<title>${request.url}</title><h1>${request.url}</h1><input id="draft" placeholder="Page draft">`)
    }
    if (request.url === '/slow') setTimeout(respond, 150)
    else respond()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const evaluate = async (code) => {
    const result = await window.webContents.executeJavaScript(`(async () => {
      try { return await (${code}) } catch (error) { return { smokeError: error.message } }
    })()`)
    if (result?.smokeError) throw new Error(`${result.smokeError}\nExpression: ${code}`)
    return result
  }
  const call = (method, ...args) => evaluate(`window.browser.${method}(${args.map((arg) => JSON.stringify(arg)).join(',')})`)
  const read = () => call('getState')
  const active = (state) => state.tabs.find((tab) => tab.id === state.activeTabId)
  async function waitFor(check, label) {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`Timed out: ${label}`)
  }
  const waitState = (check, label) => waitFor(async () => check(await read()), label)
  const views = () => window.contentView.children.filter((view) => view.webContents)
  const pageFor = (url) => views().find((view) => view.webContents.getURL() === url)
  async function submit(value) {
    await evaluate(`(() => {
      const input = document.querySelector('[aria-label="Search or enter URL"]');
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    // Let React commit the input before submitting its form.
    await evaluate('document.querySelector(".address-form").requestSubmit()')
  }
  function shortcut(contents, keyCode, modifiers) {
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }

  try {
    let state = await read()
    assert.equal(state.tabs.length, 1)
    const firstId = state.activeTabId
    assert.equal(active(state).url, '')
    assert(views().every((view) => !view.getVisible()))
    await evaluate("[...document.querySelectorAll('.home-card')].find(card => card.querySelector('.home-label').textContent === 'Browser').click()")
    await waitFor(() => evaluate('!!document.querySelector(".new-tab-page")'), 'blank tab UI')
    await submit(`${origin.replace('http://', '')}/one`)
    await waitState((state) => active(state).title === '/one' && !active(state).isLoading, 'bare loopback address navigation')
    const firstView = pageFor(`${origin}/one`)
    const firstContents = firstView.webContents
    assert(firstView.getVisible())
    assert.equal(firstView.getBounds().y, 108)
    assert.equal(await firstView.webContents.executeJavaScript('typeof window.browser + ":" + typeof require'), 'undefined:undefined')
    await firstView.webContents.executeJavaScript('document.querySelector("#draft").value = "Keep this draft"')
    await call('navigate', `${origin}/two`)
    await waitState((state) => active(state).title === '/two', 'second history entry')
    assert(active(await read()).canGoBack)
    await call('back')
    await waitState((state) => active(state).url === `${origin}/one`, 'back history')
    assert(active(await read()).canGoForward)
    await call('forward')
    await waitState((state) => active(state).url === `${origin}/two`, 'forward history')
    await evaluate(`(() => {
      const input = document.querySelector('.address-form input');
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'unfinished search');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await call('back')
    await waitState((state) => active(state).url === `${origin}/one`, 'history during address editing')
    assert.equal(await evaluate('document.querySelector(".address-form input").value'), 'unfinished search')
    await evaluate('document.querySelector(".address-form input").blur()')
    await call('forward')
    await waitState((state) => active(state).url === `${origin}/two`, 'history after address editing')

    await evaluate('document.querySelector(".new-tab-button").click()')
    await waitState((state) => state.tabs.length === 2, 'new tab button')
    state = await read()
    const secondId = state.activeTabId
    assert.notEqual(secondId, firstId)
    assert.equal(active(state).url, '')
    assert(views().every((view) => !view.getVisible()))
    await call('navigate', `${origin}/other`)
    await waitState((state) => active(state).title === '/other', 'second tab load')
    const secondView = pageFor(`${origin}/other`)
    const secondContents = secondView.webContents
    await secondView.webContents.executeJavaScript('document.querySelector("#draft").value = "Keep this draft"')
    assert.equal(active(await read()).canGoBack, true)
    await evaluate('document.querySelectorAll("[role=tab]")[0].click()')
    await waitState((state) => state.activeTabId === firstId, 'tab button switch')
    assert(firstView.getVisible())
    assert(!secondView.getVisible())
    await waitFor(() => evaluate(`document.querySelector('.address-form input').value === ${JSON.stringify(`${origin}/two`)}`), 'address follows selected tab')
    assert(active(await read()).canGoBack)
    await call('activateTab', secondId)
    assert.equal(await secondView.webContents.executeJavaScript('document.querySelector("#draft").value'), 'Keep this draft')

    await evaluate('document.querySelector(".history-controls button").click()')
    await waitFor(() => evaluate('!!document.querySelector(".home-grid")'), 'Home')
    assert(views().every((view) => !view.getVisible()))
    await evaluate("[...document.querySelectorAll('.home-card')].find(card => card.querySelector('.home-label').textContent === 'Browser').click()")
    await waitFor(() => evaluate('!!document.querySelector(".address-form")'), 'reopen Browser')
    assert.equal((await read()).activeTabId, secondId)
    assert(!secondView.getVisible())
    assert.equal(active(await read()).url, '')
    await call('back')
    await call('back')
    await waitState((state) => active(state).url === `${origin}/other`, 'return across Home and blank Browser')
    await waitFor(() => secondView.getVisible(), 'restore preserved native page')
    assert.equal(await secondView.webContents.executeJavaScript('document.querySelector("#draft").value'), 'Keep this draft')

    await submit('javascript:alert("blocked")')
    await waitFor(() => evaluate('!!document.querySelector(".navigation-error")'), 'blocked scheme error')
    assert.equal(await evaluate('document.querySelector(".navigation-error").textContent'), 'Only HTTP and HTTPS pages can be opened.')
    assert.equal(active(await read()).url, `${origin}/other`)
    await call('activateTab', firstId)
    await waitFor(() => evaluate('!document.querySelector(".navigation-error")'), 'errors stay on originating tab')
    await call('activateTab', secondId)
    await secondView.webContents.executeJavaScript(`window.open(${JSON.stringify(`${origin}/popup`)}, '_blank')`)
    await waitState((state) => state.tabs.length === 3 && active(state).title === '/popup', 'new-window link opens tab')
    assert.equal(views().filter((view) => view.getVisible()).length, 1)
    await pageFor(`${origin}/popup`).webContents.executeJavaScript("window.open('file:///tmp/blocked')")
    assert.equal((await read()).tabs.length, 3)
    const popupId = (await read()).activeTabId
    await call('closeTab', firstId)
    assert(firstContents.isDestroyed())
    assert.equal((await read()).activeTabId, popupId)
    await call('closeTab', popupId)
    assert.equal((await read()).activeTabId, secondId)
    assert(secondView.getVisible())

    const command = process.platform === 'darwin' ? 'meta' : 'control'
    shortcut(secondView.webContents, 'L', [command])
    await waitFor(() => evaluate('document.activeElement === document.querySelector(".address-form input") && document.activeElement.selectionEnd === document.activeElement.value.length'), 'address shortcut from remote page')
    shortcut(secondView.webContents, 'T', [command])
    await waitState((state) => state.tabs.length === 2 && active(state).url === '', 'new tab shortcut')
    shortcut(window.webContents, 'Tab', ['control', 'shift'])
    await waitState((state) => state.activeTabId === secondId, 'previous tab shortcut')
    shortcut(secondView.webContents, 'Tab', ['control'])
    await waitState((state) => state.activeTabId !== secondId, 'next tab shortcut')
    shortcut(window.webContents, 'W', [command])
    await waitState((state) => state.tabs.length === 1 && state.activeTabId === secondId, 'close tab shortcut')

    const loading = call('navigate', `${origin}/slow`)
    await waitState((state) => active(state).isLoading, 'loading state')
    await call('createTab')
    const temporaryId = (await read()).activeTabId
    await loading
    await waitState((state) => !state.tabs.find((tab) => tab.id === secondId).isLoading, 'background tab finishes loading')
    assert.equal((await read()).activeTabId, temporaryId)
    assert.equal(active(await read()).url, '')
    assert(views().every((view) => !view.getVisible()))
    await call('closeTab', temporaryId)
    await assert.rejects(call('navigate', `${origin}/failure`))
    await waitState((state) => Boolean(active(state).error) && !active(state).isLoading, 'load failure state')
    await call('navigate', `${origin}/other`)
    await waitState((state) => active(state).title === '/other' && !active(state).error, 'load error recovery')
    await assert.rejects(call('activateTab', 'missing-tab'))
    await assert.rejects(call('closeTab', 123))
    const screenshotDirectory = resolve(__dirname, '../.cache')
    mkdirSync(screenshotDirectory, { recursive: true })
    await call('createTab')
    await call('navigate', 'app://browser')
    await waitFor(() => evaluate('!!document.querySelector(".new-tab-page") && document.querySelectorAll("[role=tab]").length === 2'), 'capture tab UI')
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100))))')
    writeFileSync(resolve(screenshotDirectory, 'browser-tabs.png'), (await window.capturePage()).toPNG())
    await call('closeTab', (await read()).activeTabId)
    await call('closeTab', secondId)
    state = await read()
    assert.equal(state.tabs.length, 1)
    assert.equal(active(state).url, '')
    assert(secondContents.isDestroyed())
    assert(views().every((view) => !view.getVisible()))
    assert.equal(views().length, 0)
    await require('./navigation-smoke.cjs')({ window, call, read, active, evaluate, waitFor, waitState, views, pageFor, origin, shortcut })
    console.log('Browser smoke passed: tab UI/lifecycle, independent histories and page state, Home visibility, native bounds, shortcuts, URL input, pop-ups, isolation and load errors.')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
