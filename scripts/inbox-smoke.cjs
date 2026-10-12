const assert = require('node:assert/strict')
const { session } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

module.exports = async function inboxSmoke({ window, call, read, active, evaluate, waitFor, waitState, views, shortcut, origin }) {
  const webSession = session.fromPartition('persist:job-agent-browser')
  // All provider traffic is redirected to our local fixture, without contacting a mail service.
  webSession.webRequest.onBeforeRequest({ urls: ['https://mail.fixture.invalid/*'] }, (details, callback) => {
    callback({ redirectURL: `${origin}${new URL(details.url).pathname}` })
  })
  const saveMailbox = mailbox => evaluate(`window.data.settings.savePreferences(${JSON.stringify({ mailbox })})`)
  const mailbox = async url => {
    await waitState(state => active(state).destination.surface === 'inbox' && active(state).url === url && !active(state).isLoading, 'dedicated Inbox destination')
    await waitFor(() => evaluate('!!document.querySelector(".inbox-page") && !document.querySelector(".tab-strip, .browser-controls, .address-form, .settings-navigation, .app-error")'), 'Inbox without application top bars')
    const view = views().find(view => view.webContents.getURL() === url)
    view.webContents.setBackgroundThrottling(false)
    await waitFor(() => view.getVisible(), 'full-page mailbox visible')
    const [width, height] = window.getContentSize()
    const sidebarWidth = width <= 960 ? 64 : 208
    assert.deepEqual(view.getBounds(), { x: sidebarWidth, y: 0, width: width - sidebarWidth, height })
    const sidebar = await evaluate(`(() => {
      const nav = document.querySelector('.ui-sidebar'), rect = nav.getBoundingClientRect();
      return { width: rect.width, right: rect.right, current: nav.querySelector('[aria-current=page]').getAttribute('aria-label'), count: nav.querySelectorAll('button').length, footer: !!document.querySelector('.inbox-exit') };
    })()`)
    assert.deepEqual(sidebar, { width: sidebarWidth, right: sidebarWidth, current: 'Inbox', count: 10, footer: false })
    assert(sidebar.right <= view.getBounds().x, 'The native mailbox must not cover sidebar navigation')
    assert.equal(views().filter(view => view.getVisible()).length, 1)
    assert.equal(active(await read()).title, 'Inbox')
    assert.equal(await view.webContents.executeJavaScript('typeof window.browser + ":" + typeof require'), 'undefined:undefined')
    return view
  }
  try {
    await call('navigate', `${origin}/before-mailbox`)
    const browserView = views().find(view => view.webContents.getURL() === `${origin}/before-mailbox`)
    assert.equal(browserView.getBounds().y, 96)
    assert.equal((await saveMailbox({ provider: 'custom', url: 'https://mail.fixture.invalid/mailbox-one' })).ok, true)
    await call('navigate', 'app://inbox')
    const view = await mailbox(`${origin}/mailbox-one`)
    assert.notEqual(view, browserView, 'Inbox and Browser need independent native segments')
    assert.equal(browserView.getVisible(), false)
    const presentation = { tabId: active(await read()).id, targetId: active(await read()).targetId }
    await view.webContents.executeJavaScript('document.querySelector("#draft").value = "Retained mailbox draft"')
    await evaluate('document.querySelector(".ui-sidebar button[aria-label=Home]").click()')
    await waitState(state => active(state).destination.page === 'home', 'sidebar Home leaves Inbox')
    await call('setVisible', true, presentation)
    assert.equal(view.getVisible(), false, 'Stale mailbox acknowledgments cannot cover Home')
    await call('back')
    assert.equal(await mailbox(`${origin}/mailbox-one`), view)
    assert.equal(await view.webContents.executeJavaScript('document.querySelector("#draft").value'), 'Retained mailbox draft')

    await call('navigate', `${origin}/ordinary-browser`)
    await waitFor(() => evaluate('!!document.querySelector(".tab-strip, .address-form")'), 'ordinary Browser retains chrome')
    const ordinary = views().find(view => view.webContents.getURL() === `${origin}/ordinary-browser`)
    assert.equal(ordinary.getBounds().y, 96)
    assert.equal(active(await read()).destination.surface, undefined)
    await call('back')
    await mailbox(`${origin}/mailbox-one`)
    await call('forward')
    await waitFor(() => ordinary.getVisible(), 'Browser forward restoration')
    await call('back'); await mailbox(`${origin}/mailbox-one`)

    // Native login/navigation stays in Inbox and does not expose an address bar.
    await view.webContents.executeJavaScript(`location.href = ${JSON.stringify(`${origin}/mailbox-two`)}`)
    await mailbox(`${origin}/mailbox-two`)
    await call('back'); await mailbox(`${origin}/mailbox-one`)
    await call('forward'); await mailbox(`${origin}/mailbox-two`)
    view.webContents.focus()
    await view.webContents.executeJavaScript('document.querySelector("#draft").focus()')
    shortcut(view.webContents, 'L', [process.platform === 'darwin' ? 'meta' : 'control'])
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.equal(await evaluate('!!document.querySelector(".address-form, .tab-strip")'), false)

    const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve))
    window.webContents.reload(); await loaded
    assert.equal(await mailbox(`${origin}/mailbox-two`), view)
    const originalSize = window.getContentSize(), originalMinimum = window.getMinimumSize()
    window.setMinimumSize(320, 320)
    try {
      for (const width of [320, 640, 960, 968, 1200]) {
        window.setContentSize(width, 820)
        await waitFor(() => evaluate(`innerWidth === ${width}`), `Inbox viewport ${width}`)
        await mailbox(`${origin}/mailbox-two`)
      }
    } finally { window.setContentSize(...originalSize); window.setMinimumSize(...originalMinimum) }
    mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
    await mailbox(`${origin}/mailbox-two`)
    assert.equal(await view.webContents.executeJavaScript('document.body.innerText.includes("/mailbox-two")'), true)
    // BrowserWindow.capturePage captures only the trusted renderer, not its native child view.
    const capture = await Promise.race([
      view.webContents.capturePage(undefined, { stayAwake: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Mailbox native capture timed out')), 5000))
    ])
    assert.equal(capture.isEmpty(), false)
    writeFileSync(resolve(__dirname, '../.cache/inbox-no-chrome.png'), capture.toPNG())

    const inboxTab = (await read()).activeTabId
    await view.webContents.executeJavaScript(`window.open(${JSON.stringify(`${origin}/mailbox-popup`)}, '_blank')`)
    await mailbox(`${origin}/mailbox-popup`)
    const popup = (await read()).activeTabId
    assert.notEqual(popup, inboxTab)
    await call('closeTab', popup)
    await mailbox(`${origin}/mailbox-two`)

    // Load failures show page-owned feedback and recovery actions, still without chrome.
    await saveMailbox({ provider: 'custom', url: 'https://mail.fixture.invalid/failure' })
    await assert.rejects(call('navigate', 'app://inbox'))
    await waitFor(() => evaluate('document.body.innerText.includes("Unable to open your mailbox") && !!document.querySelector(".inbox-page--message")'), 'mailbox failure feedback')
    assert.equal(views().some(view => view.getVisible()), false)
    assert.equal(await evaluate('!!document.querySelector(".tab-strip, .browser-controls, .address-form, .app-error")'), false)
    await saveMailbox({ provider: 'custom', url: 'https://mail.fixture.invalid/mailbox-recovered' })
    await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent === "Try again").click()')
    await mailbox(`${origin}/mailbox-recovered`)
    await saveMailbox({ provider: 'none', url: '' })
    await call('navigate', 'app://inbox')
    await waitFor(() => evaluate('document.body.innerText.includes("Connect your mailbox")'), 'unconfigured Inbox')
    assert.equal(views().some(view => view.getVisible()), false)
    assert.equal(await evaluate('!!document.querySelector(".tab-strip, .browser-controls, .address-form")'), false)
    await call('navigate', 'app://home')
    console.log('Inbox smoke passed: full-content native bounds, no app top bars, redirects/history/reload/popups, retained drafts, responsive resizing, isolation and failure recovery.')
  } finally { webSession.webRequest.onBeforeRequest(null) }
}
