const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

module.exports = async function navigationSmoke({ window, call, read, active, evaluate, waitFor, waitState, views, pageFor, origin, shortcut }) {
  const routes = [
    ['Add Job', 'find'], ['Tailor Resume', 'resume'], ['Smart Note', 'knowledge'],
    ['Applications', 'applications'], ['Inbox', 'inbox'], ['My Profile', 'profile'],
    ['Ask AI', 'ai'], ['Settings', 'settings']
  ]
  const capture = async (name) => {
    const directory = resolve(__dirname, '../.cache')
    mkdirSync(directory, { recursive: true })
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    writeFileSync(resolve(directory, name), (await window.capturePage()).toPNG())
  }
  const reloadRenderer = async () => {
    const loaded = new Promise((resolve) => window.webContents.once('did-finish-load', resolve))
    window.webContents.reload()
    await loaded
  }
  const internal = async (page) => {
    await waitState((state) => active(state).destination.kind === 'internal' && active(state).destination.page === page, page)
    await waitFor(() => evaluate('!document.querySelector(".tab-strip") && !document.querySelector(".address-form")'), 'internal UI without browser chrome')
    assert(views().every((view) => !view.getVisible()))
    assert.equal(await evaluate('document.body.innerText.includes("app://")'), false)
  }
  const home = async () => {
    await waitFor(() => evaluate('!!document.querySelector(".home-grid")'), 'Home grid')
    assert.equal(await evaluate('document.querySelectorAll(".home-page button").length'), 9)
    assert.equal(await evaluate('!!document.querySelector(".home-back")'), false)
  }
  await call('navigate', 'app://home')
  assert.equal(active(await read()).destination.page, 'home')
  await home()
  for (const [title, page] of routes) {
    await evaluate(`(() => { [...document.querySelectorAll('.home-card')].find(card => card.querySelector('.ui-card-label').textContent === ${JSON.stringify(title)}).click() })()`)
    await internal(page)
    if (page === 'ai') await waitFor(() => evaluate('!!document.querySelector(".ai-composer")'), 'Ask AI conversation surface')
    else await waitFor(() => evaluate(`document.querySelector('h1')?.textContent === ${JSON.stringify(title)}`), 'feature title')
    assert.equal(await evaluate('document.body.innerText.includes("not implemented yet")'), !['settings', 'inbox', 'ai', 'profile', 'find', 'applications', 'resume', 'knowledge'].includes(page))
    if (page === 'settings') await waitFor(() => evaluate('!!document.querySelector("[data-settings-general]") && !!document.querySelector("[data-ai-config]") && !!document.querySelector("[data-settings-mailbox-form]")'), 'Settings forms')
    else if (!['ai','knowledge'].includes(page)) assert.deepEqual(await evaluate('[...document.querySelectorAll(".page-actions button")].map(button => button.textContent)'), page === 'inbox' ? ['Go home', 'Open Settings'] : ['Go home'])
    if (page === 'profile') await capture('internal-page.png')
    if (page === 'inbox') {
      await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Open Settings').click()")
      await internal('settings')
    }
    if (['ai','knowledge'].includes(page)) await evaluate('document.querySelector(".ui-sidebar button[aria-label=Home]").click()')
    else {
      await waitFor(() => evaluate('!!document.querySelector(".settings-navigation button, .page-actions button")'), 'Go home button')
      await evaluate('document.querySelector(".settings-navigation button, .page-actions button").click()')
    }
    await internal('home')
    await home()
  }
  await capture('react-home.png')
  // Workspace navigation never becomes part of a Browser tab's native history.
  await call('createTab')
  const journeyId = (await read()).activeTabId
  await waitFor(() => evaluate('!!document.querySelector(".new-tab-page")'), 'new tab opens Browser')
  assert.equal(active(await read()).destination.page, 'browser')
  assert.equal(active(await read()).canGoBack, false)
  await call('navigate', `${origin}/one`)
  assert.equal(active(await read()).canGoBack, false, 'First webpage cannot go back to Home or a blank tab')
  await call('navigate', `${origin}/two`)
  const a = pageFor(`${origin}/two`), aContents = a.webContents
  await aContents.executeJavaScript('document.querySelector("#draft").value = "Retained browser draft"')
  const stale = { tabId: journeyId, targetId: active(await read()).targetId }
  await call('navigate', 'app://resume'); await internal('resume')
  const resumeTarget = active(await read()).targetId
  await call('setVisible', true, stale)
  assert(!a.getVisible())
  for (const method of ['back', 'forward']) await call(method)
  shortcut(window.webContents, 'Left', ['alt'])
  shortcut(window.webContents, 'Right', ['alt'])
  await internal('resume')
  assert.equal(active(await read()).targetId, resumeTarget)
  assert.equal(active(await read()).canGoBack, false)
  assert.equal(active(await read()).canGoForward, false)
  await call('navigate', 'app://browser')
  await waitFor(() => a.getVisible(), 'Browser restores retained view')
  assert.equal(active(await read()).url, `${origin}/two`)
  assert.equal(await aContents.executeJavaScript('document.querySelector("#draft").value'), 'Retained browser draft')
  await call('back')
  await waitState(state => active(state).url === `${origin}/one`, 'native Back')
  assert.equal(active(await read()).canGoBack, false)
  await call('back')
  assert.equal(active(await read()).url, `${origin}/one`)
  // Visiting multiple features after Back preserves the native forward stack.
  for (const page of ['settings', 'profile', 'home']) {
    await call('navigate', `app://${page}`); await internal(page)
  }
  await call('navigate', 'app://browser')
  assert(active(await read()).canGoForward)
  await call('forward')
  await waitState(state => active(state).url === `${origin}/two`, 'forward after workspace navigation')
  await call('back')
  await waitState(state => active(state).url === `${origin}/one`, 'branch position')
  await call('navigate', 'app://settings'); await internal('settings')
  await call('navigate', `${origin}/linked`)
  assert.equal(pageFor(`${origin}/linked`), a, 'Returning with a URL reuses the same Browser surface')
  assert.equal(active(await read()).canGoForward, false)
  assert.equal(aContents.navigationHistory.length(), 2)
  // SPA push, replace, repeated URLs and website-driven history use native entry identity.
  await aContents.executeJavaScript("history.pushState({}, '', '/spa'); history.replaceState({}, '', '/spa-replaced')")
  await waitState(state => active(state).url === `${origin}/spa-replaced`, 'SPA push/replace')
  const beforeDuplicate = aContents.navigationHistory.length()
  await aContents.executeJavaScript("history.pushState({}, '', location.href)")
  await waitFor(() => aContents.navigationHistory.length() === beforeDuplicate + 1, 'duplicate URL')
  await call('back')
  await waitFor(() => aContents.navigationHistory.getActiveIndex() === beforeDuplicate - 1, 'duplicate history traversal')
  await call('navigate', 'app://profile'); await internal('profile')
  await reloadRenderer()
  await waitFor(() => evaluate('!!window.browser && document.querySelector("h1")?.textContent === "My Profile"'), 'renderer internal reload')
  await internal('profile')
  await call('navigate', 'app://browser')
  await waitFor(() => a.getVisible(), 'Browser after renderer reload')
  assert.equal(aContents.navigationHistory.getActiveIndex(), beforeDuplicate - 1)
  assert(active(await read()).canGoForward)
  await aContents.executeJavaScript("history.replaceState({}, '', '/replace-current')")
  await waitState(state => active(state).url === `${origin}/replace-current`, 'replace entry')
  assert(active(await read()).canGoForward)
  await call('forward')
  await waitState(state => active(state).url === `${origin}/spa-replaced`, 'native forward after replace')
  const beforeReload = { tabId: journeyId, targetId: active(await read()).targetId }
  await reloadRenderer()
  await waitFor(async () => (await evaluate('!!document.querySelector(".address-form")')) && a.getVisible(), 'renderer Browser reload')
  assert.notEqual(active(await read()).targetId, beforeReload.targetId)
  await call('setVisible', false, beforeReload)
  assert(a.getVisible())
  const priorURL = active(await read()).url
  await aContents.executeJavaScript("location.href = 'app://home'")
  assert.equal(active(await read()).url, priorURL)
  assert.equal(active(await read()).destination.kind, 'web')
  await call('navigate', `${origin}/redirect`)
  await waitState(state => active(state).url === `${origin}/redirect-final` && !active(state).isLoading, 'redirect commit')
  shortcut(aContents, 'Left', ['alt'])
  await waitState(state => active(state).url === priorURL, 'Browser Alt+Left')
  shortcut(window.webContents, 'Right', ['alt'])
  await waitState(state => active(state).url === `${origin}/redirect-final`, 'Browser Alt+Right')
  // A late loading completion cannot reactivate a surface after switching pages.
  const slow = call('navigate', `${origin}/slow`)
  await waitState(state => active(state).isLoading, 'pending navigation')
  await call('navigate', 'app://settings'); await internal('settings')
  await slow; await internal('settings')
  await call('closeTab', journeyId)
  assert(aContents.isDestroyed())
  await call('createTab')
  const closingId = (await read()).activeTabId
  const closingLoad = call('navigate', `${origin}/slow`)
  await waitState(state => active(state).isLoading, 'closing navigation')
  await call('closeTab', closingId)
  await closingLoad
  assert.notEqual((await read()).activeTabId, closingId)
  await assert.rejects(call('navigate', 'app://unknown'))
  await call('navigate', 'app://home')
  console.log('Navigation smoke passed: workspace/history separation, retained views/forward history, new tabs, native boundaries, duplicate URLs, SPA, stale visibility, reload and navigation races.')
}
