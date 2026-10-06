const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

module.exports = async function navigationSmoke({ window, call, read, active, evaluate, waitFor, waitState, views, pageFor, origin, shortcut }) {
  const routes = [
    ['Find Jobs', 'find'], ['Tailor Resume', 'resume'], ['Interview Prep', 'interview'],
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
  assert.equal(active(await read()).destination.page, 'home')
  for (const [title, page] of routes) {
    await evaluate(`(() => { [...document.querySelectorAll('.home-card')].find(card => card.querySelector('.home-label').textContent === ${JSON.stringify(title)}).click() })()`)
    await internal(page)
    await waitFor(() => evaluate(`document.querySelector('h1')?.textContent === ${JSON.stringify(title)}`), 'feature title')
    assert.equal(await evaluate('document.body.innerText.includes("not implemented yet")'), true)
    if (page === 'profile') await capture('internal-page.png')
    if (page === 'inbox') {
      await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Open Settings').click()")
      await internal('settings')
    }
    await call('navigate', 'app://home')
    await waitFor(() => evaluate('!!document.querySelector(".home-grid")'), 'Home grid')
  }
  await capture('react-home.png')
  // Start an isolated journey and verify each native/app boundary in both directions.
  await call('createTab')
  const journeyId = (await read()).activeTabId
  await call('navigate', 'app://find')
  await call('navigate', `${origin}/one`)
  await call('navigate', `${origin}/two`)
  const a = pageFor(`${origin}/two`), aContents = a.webContents
  await aContents.executeJavaScript('document.querySelector("#draft").value = "Mixed history draft"')
  const stale = { tabId: journeyId, targetId: active(await read()).targetId }
  await call('navigate', 'app://resume')
  await internal('resume')
  await call('setVisible', true, stale)
  assert(!a.getVisible())
  await call('navigate', `${origin}/other`)
  const c = pageFor(`${origin}/other`), cContents = c.webContents
  for (const target of ['resume', `${origin}/two`, `${origin}/one`, 'find', 'home']) {
    await call('back')
    if (target.startsWith('http')) await waitState((state) => active(state).url === target, 'mixed back')
    else await internal(target)
    if (target === `${origin}/two`) {
      await waitFor(() => a.getVisible(), 'preserved segment visible')
      assert.equal(await aContents.executeJavaScript('document.querySelector("#draft").value'), 'Mixed history draft')
    }
  }
  assert.equal(active(await read()).canGoBack, false)
  for (const target of ['find', `${origin}/one`, `${origin}/two`, 'resume', `${origin}/other`]) {
    await call('forward')
    if (target.startsWith('http')) await waitState((state) => active(state).url === target, 'mixed forward')
    else await internal(target)
  }
  assert.equal(active(await read()).canGoForward, false)
  // Fork while inside the older native segment: drop its native future and the later segment.
  await call('back'); await call('back'); await call('back')
  await waitState((state) => active(state).url === `${origin}/one`, 'branch position')
  await call('navigate', 'app://settings')
  await internal('settings')
  assert(cContents.isDestroyed())
  assert.equal(aContents.navigationHistory.length(), 1)
  await call('back')
  await waitState((state) => active(state).url === `${origin}/one`, 'older segment')
  // A website link branches app history without creating a second native segment.
  await aContents.executeJavaScript(`location.href = ${JSON.stringify(`${origin}/linked`)}`)
  await waitState((state) => active(state).url === `${origin}/linked` && !active(state).isLoading, 'website link')
  assert.equal(active(await read()).canGoForward, false)
  await aContents.executeJavaScript("history.pushState({}, '', '/spa'); history.replaceState({}, '', '/spa-replaced')")
  await waitState((state) => active(state).url === `${origin}/spa-replaced`, 'SPA push/replace')
  // Native same-URL branching must invalidate an app future, using native
  // page state/index rather than URL equality to distinguish new entries.
  await aContents.executeJavaScript("history.pushState({}, '', '/same-url'); history.pushState({}, '', '/same-url')")
  await waitState((state) => active(state).url === `${origin}/same-url`, 'repeated SPA URL')
  await call('navigate', 'app://profile')
  await call('back'); await call('back')
  await waitFor(() => aContents.navigationHistory.getActiveIndex() === aContents.navigationHistory.length() - 2, 'older repeated URL entry')
  await aContents.executeJavaScript("history.pushState({}, '', '/same-url')")
  await waitState((state) => !active(state).canGoForward, 'same-URL native branch prunes internal future')
  // A website's own history traversal preserves its app-level future.
  await call('navigate', 'app://resume'); await call('back')
  await aContents.executeJavaScript('history.back()')
  await waitFor(() => aContents.navigationHistory.getActiveIndex() === aContents.navigationHistory.length() - 2, 'website back')
  await aContents.executeJavaScript('history.forward()')
  await waitFor(() => aContents.navigationHistory.getActiveIndex() === aContents.navigationHistory.length() - 1, 'website forward')
  await call('forward'); await internal('resume')
  await call('back')
  // Remove the native test entries before continuing the duplicate-entry journey.
  await call('navigate', `${origin}/linked`)
  await aContents.executeJavaScript("history.pushState({}, '', '/spa-replaced')")
  await waitState((state) => active(state).url === `${origin}/spa-replaced`, 'SPA fixture restored')
  // Duplicate URL entries remain distinct native history items.
  const beforeDuplicate = aContents.navigationHistory.length()
  await aContents.executeJavaScript("history.pushState({}, '', location.href)")
  await waitFor(() => aContents.navigationHistory.length() === beforeDuplicate + 1, 'duplicate native URL')
  await call('navigate', 'app://profile')
  await call('back')
  await waitState((state) => active(state).url === `${origin}/spa-replaced`, 'resume duplicate entry')
  await call('back')
  await waitFor(() => aContents.navigationHistory.getActiveIndex() === beforeDuplicate - 1, 'duplicate history traversal')
  await call('back')
  await waitState((state) => active(state).url === `${origin}/linked`, 'SPA back')
  // replaceState must preserve the app-level forward destination.
  await aContents.executeJavaScript("history.replaceState({}, '', '/replace-current')")
  await waitState((state) => active(state).url === `${origin}/replace-current`, 'replace active entry')
  assert(active(await read()).canGoForward)
  await call('forward'); await call('forward'); await call('forward')
  await internal('profile')
  // Reload restores Main's current internal page, without revealing native views.
  await reloadRenderer()
  await waitFor(() => evaluate('!!window.browser && document.querySelector("h1")?.textContent === "My Profile"'), 'renderer internal reload')
  await internal('profile')
  await call('back')
  await waitFor(() => a.getVisible(), 'Browser after renderer reload')
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
  await waitState((state) => active(state).url === `${origin}/redirect-final` && !active(state).isLoading, 'redirect commit')
  await call('back')
  await waitState((state) => active(state).url === priorURL, 'redirect is one native navigation')
  // Alt history keys work while the browser toolbar is absent.
  await call('navigate', 'app://resume'); await internal('resume')
  shortcut(window.webContents, 'Left', ['alt'])
  await waitState((state) => active(state).destination.kind === 'web', 'internal keyboard Back')
  // A late loading completion cannot reactivate a segment after switching to an internal page.
  const slow = call('navigate', `${origin}/slow`)
  await waitState((state) => active(state).isLoading, 'pending navigation')
  await call('navigate', 'app://settings'); await internal('settings')
  await slow
  await internal('settings')
  await call('closeTab', journeyId)
  assert(aContents.isDestroyed())
  // Close a tab during navigation; completion must not change the replacement Home.
  await call('createTab')
  const closingId = (await read()).activeTabId
  const closingLoad = call('navigate', `${origin}/slow`)
  await waitState((state) => active(state).isLoading, 'closing navigation')
  await call('closeTab', closingId)
  await closingLoad
  assert.notEqual((await read()).activeTabId, closingId)
  await assert.rejects(call('navigate', 'app://unknown'))
  console.log('Navigation smoke passed: nine entries, hidden internal URLs/chrome, mixed history, branching/disposal, duplicate URLs, SPA history, stale visibility, reload and navigation races.')
}
