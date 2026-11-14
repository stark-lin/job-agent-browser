const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

module.exports = async function browserSmoke(window) {
  const server = createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/redirect-final' }); response.end(); return }
    if (request.url === '/failure') { response.destroy(); return }
    if (request.url === '/copy-fixture' || request.url === '/copy-empty') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(request.url === '/copy-empty' ? '<title>Empty copy fixture</title>' : `
        <title>Copy fixture</title>
        <style>* { user-select: none }</style>
        <nav>Menu</nav>
        <main>Lead<div><h1>Copy test</h1>Between<p>First&nbsp;  line<br>Second
          <strong>line</strong></p><ul><li>Item</li></ul></div>Tail
          <table><tr><th>Role</th><td>Engineer</td></tr></table>
          <span hidden>Hidden text</span>
          <style>.excluded-body-style { display: none }</style>
          <noscript>No-script text</noscript><template>Template text</template>
          <svg><text>SVG text</text></svg><canvas>Canvas fallback</canvas>
          <iframe srcdoc="<p>Frame text</p>" hidden></iframe>
          <div id="shadow"></div>
        </main>
        <footer>Footer</footer>
        <script>
          document.addEventListener('copy', event => event.preventDefault());
          document.getElementById('shadow').attachShadow({ mode: 'open' }).textContent = 'Shadow text';
          window.DOMParser = class { constructor() { throw new Error('Page override') } };
          setTimeout(() => document.querySelector('main').append(Object.assign(document.createElement('p'), { id: 'dynamic-copy', textContent: 'Dynamic text' })), 20);
        </script>
      `)
      return
    }
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
  const views = () => require('./native-views.cjs').views(window)
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
    if (process.env.JOB_BROWSER_SMART_PASTE_SMOKE === '1') {
      await require('./smart-paste-smoke.cjs')({ window, call, read, active, evaluate, waitFor, views })
      return
    }
    let state = await read()
    assert.equal(state.tabs.length, 1)
    const firstId = state.activeTabId
    assert.equal(active(state).url, '')
    assert(views().every((view) => !view.getVisible()))
    assert.deepEqual(active(state).destination, { kind: 'internal', page: 'ai' })
    await waitFor(() => evaluate('!!document.querySelector(".ai-composer")'), 'Ask AI at startup')
    const sidebar = label => evaluate(`document.querySelector('.ui-sidebar button[aria-label=${JSON.stringify(label)}]').click()`)
    await sidebar('Browser')
    await waitFor(() => evaluate('!!document.querySelector(".new-tab-page")'), 'blank tab UI')
    await submit(`${origin.replace('http://', '')}/one`)
    await waitState((state) => active(state).title === '/one' && !active(state).isLoading, 'bare loopback address navigation')
    const firstView = pageFor(`${origin}/one`)
    const firstContents = firstView.webContents
    assert(firstView.getVisible())
    assert.equal(require('./native-views.cjs').bounds(window, firstView).y, 96)
    const sidebarWidth = 64
    assert.equal(require('./native-views.cjs').bounds(window, firstView).x, sidebarWidth)
    assert.equal(require('./native-views.cjs').bounds(window, firstView).width, window.getContentSize()[0] - sidebarWidth)
    const chrome = await evaluate(`(() => {
      const tabs = document.querySelector('.tab-strip').getBoundingClientRect();
      const toolbar = document.querySelector('.browser-controls').getBoundingClientRect();
      return { tabs: tabs.height, toolbar: toolbar.height, bottom: toolbar.bottom };
    })()`)
    assert.deepEqual(chrome, { tabs: 48, toolbar: 48, bottom: 96 })
    assert.equal(require('./native-views.cjs').bounds(window, firstView).y, chrome.bottom, 'Native view must meet the rendered toolbar')
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
    assert.equal(active(await read()).canGoBack, false)
    await evaluate('document.querySelectorAll("[role=tab]")[0].click()')
    await waitState((state) => state.activeTabId === firstId, 'tab button switch')
    assert(firstView.getVisible())
    assert(!secondView.getVisible())
    await waitFor(() => evaluate(`document.querySelector('.address-form input').value === ${JSON.stringify(`${origin}/two`)}`), 'address follows selected tab')
    assert(active(await read()).canGoBack)
    await call('activateTab', secondId)
    assert.equal(await secondView.webContents.executeJavaScript('document.querySelector("#draft").value'), 'Keep this draft')

    assert.deepEqual(await evaluate('[...document.querySelectorAll(".history-controls button")].map(button => button.getAttribute("aria-label"))'), ['Go back', 'Go forward', 'Refresh'])
    await sidebar('Ask AI')
    await waitFor(() => evaluate('!!document.querySelector(".ai-composer")'), 'Ask AI')
    assert(views().every((view) => !view.getVisible()))
    await sidebar('Browser')
    await waitFor(() => evaluate('!!document.querySelector(".address-form")'), 'reopen Browser')
    assert.equal((await read()).activeTabId, secondId)
    await waitFor(() => secondView.getVisible(), 'restore retained native page')
    assert.equal(active(await read()).url, `${origin}/other`)
    assert.equal(active(await read()).canGoBack, false)
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
    await require('./browser-copy-smoke.cjs')({ window, call, read, evaluate, waitFor, pageFor, origin })
    await require('./history-gesture-smoke.cjs')({ window, call, read, active, evaluate, waitFor, waitState, views, origin })
    await require('./navigation-smoke.cjs')({ window, call, read, active, evaluate, waitFor, waitState, views, pageFor, origin, shortcut })
    await require('./sidebar-smoke.cjs')({ window, call, read, active, evaluate, waitFor, waitState, views, shortcut, origin })
    await require('./ai-smoke.cjs')({ window, call, evaluate, waitFor })
    await require('./profile-smoke.cjs')({ window, call, read, active, evaluate, waitFor })
    await require('./job-smoke.cjs')({ window, call, read, active, evaluate, waitFor })
    await require('./browser-selection-smoke.cjs')({ window, call, read, active, evaluate, waitFor })
    await require('./settings-smoke.cjs')({ window, call, read, active, evaluate, waitFor, waitState, views, shortcut, origin })
    console.log('Browser smoke passed: tab UI/lifecycle, independent histories and page state, Ask AI startup and visibility, native bounds, shortcuts, URL input, pop-ups, isolation and load errors.')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
