const assert = require('node:assert/strict')
const { app, dialog, safeStorage, session } = require('electron')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const openSectionCards = require('./open-section-cards.cjs')

module.exports = async function settingsSmoke({ window, call, read, active, evaluate, waitFor, waitState, views, shortcut, origin }) {
  const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const formsReady = () => waitFor(() => evaluate('!!document.querySelector("[data-settings-general]") && !!document.querySelector("[data-ai-config]") && !!document.querySelector("[data-settings-mailbox-form]")'), 'Settings forms ready')
  const openForms = () => openSectionCards(evaluate, '[data-settings-general], [data-ai-config], [data-settings-mailbox-form]')
  const assertCardGaps = async () => {
    const gaps = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.settings-sections > details, [data-audit-viewer] > details')];
      return cards.slice(1).map((card, index) => card.getBoundingClientRect().top - cards[index].getBoundingClientRect().bottom);
    })()`)
    assert(gaps.length > 0 && gaps.every(gap => gap === 24), `Expected 24px between Settings cards, got ${gaps}`)
  }
  const field = async (selector, value, type = 'input') => {
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(${type === 'select' ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event(${JSON.stringify(type === 'select' ? 'change' : 'input')}, { bubbles: true }));
    })()`)
    await frames()
  }
  const data = async (group, method, input) => evaluate(`window.data.${group}.${method}(${JSON.stringify(input)})`)
  const submit = index => evaluate(`document.querySelector(${JSON.stringify(['[data-settings-general]', '[data-ai-config]', '[data-ai-key]', '[data-settings-mailbox-form]'][index])}).requestSubmit()`)
  const capture = async name => {
    mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
    await frames()
    writeFileSync(resolve(__dirname, '../.cache', name), (await window.capturePage()).toPNG())
  }
  await call('navigate', 'app://settings')
  await formsReady()
  assert.equal(await evaluate('!!document.querySelector(".tab-strip, .address-form")'), false)
  assert(views().every(view => !view.getVisible()))
  assert.equal(await evaluate('document.querySelectorAll(".settings-page .ui-section-card[open]").length'), 0)
  await assertCardGaps()
  assert.equal(await evaluate(`[...document.querySelectorAll(".settings-page .ui-section-card")].every(card =>
    card.querySelector(":scope > summary h2").textContent.trim() &&
    !card.querySelector(":scope > .ui-section-body").checkVisibility())`), true)
  await capture('settings-collapsed.png')
  window.show()
  if (process.platform === 'darwin') app.focus({ steal: true })
  window.focus()
  window.webContents.focus()
  await evaluate('document.querySelector("[data-settings-general]").closest("details").querySelector("summary").focus()')
  assert.equal(await evaluate('document.activeElement.tagName'), 'SUMMARY')
  shortcut(window.webContents, 'Space', [])
  await waitFor(() => evaluate('document.querySelector("[data-settings-general]").checkVisibility()'), 'keyboard expands Settings card')
  await openForms()
  const geometry = await evaluate(`(() => {
    const section = document.querySelector('.ui-section-card'), input = document.querySelector('.ui-input');
    return { padding: getComputedStyle(section).padding, radius: getComputedStyle(section).borderRadius, height: input.getBoundingClientRect().height,
      labels: [...document.querySelectorAll('.ui-field-label')].every(label => !!document.getElementById(label.htmlFor)) };
  })()`)
  assert.deepEqual(geometry, { padding: '24px', radius: '16px', height: 40, labels: true })
  await require('./audit-viewer-smoke.cjs')({ window, call, evaluate, waitFor, field, data, capture })
  await formsReady()
  await require('./theme-smoke.cjs')({ window, call, read, active, evaluate, waitFor, waitState, views, origin, field, submit, formsReady, capture, data })
  await openForms()
  await require('./external-mcp-smoke.cjs')({ window, evaluate, waitFor, data, capture })
  await formsReady(); await openForms()
  await capture('settings-en.png')

  // Change through React controls and the production IPC, then reload the renderer.
  await field('.settings-page form:not([data-audit-filters]) select', 'zh-CN', 'select')
  await submit(0)
  await waitFor(() => evaluate('document.documentElement.lang === "zh-CN" && document.querySelector(".settings-page").getAttribute("aria-label") === "设置"'), 'saved Chinese UI')
  await waitState(state => state.language === 'zh-CN' && active(state).title === '设置', 'Main language follows saved preference')
  assert.equal(await evaluate('document.querySelector("[data-audit-viewer] h2").textContent'), '审计日志')
  assert.equal(await evaluate('document.querySelector("[data-audit-viewer] button[type=submit]").textContent'), '查询日志')
  assert.equal((await data('settings', 'get', {})).value.language, 'zh-CN')
  await capture('settings-zh.png')
  const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve))
  window.webContents.reload()
  await loaded
  await formsReady()
  await openForms()
  await waitFor(() => evaluate('document.documentElement.lang === "zh-CN"'), 'Chinese preference after reload')

  const originalSize = window.getContentSize(), originalMinimum = window.getMinimumSize()
  window.setMinimumSize(320, 320)
  try {
    for (const width of [320, 640, 1200]) {
      window.setContentSize(width, 820)
      await waitFor(() => evaluate(`window.innerWidth === ${width}`), `Settings viewport ${width}`)
      await assertCardGaps()
      assert.equal(await evaluate('document.querySelector(".settings-page").scrollWidth > document.querySelector(".settings-page").clientWidth'), false)
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".settings-fields")).gridTemplateColumns.split(" ").length'), width <= 640 ? 1 : 2)
      if (width === 320) await capture('settings-narrow.png')
    }
  } finally { window.setContentSize(...originalSize); window.setMinimumSize(...originalMinimum) }

  await field('.settings-page form:not([data-audit-filters]) select', 'en', 'select')
  await submit(0)
  await waitFor(() => evaluate('document.documentElement.lang === "en"'), 'English restored')
  // Invalid URLs receive field feedback and never persist.
  await field('[data-settings-mailbox] select', 'custom', 'select')
  await field('[data-settings-mailbox] input', 'https://user:password@example.com')
  await evaluate('document.querySelector("[data-settings-mailbox] > summary").click()')
  assert.equal(await evaluate('document.querySelector("[data-settings-mailbox] input").checkVisibility()'), false)
  await openSectionCards(evaluate, '[data-settings-mailbox]')
  assert.equal(await evaluate('document.querySelector("[data-settings-mailbox] input").value'), 'https://user:password@example.com')
  await submit(3)
  await waitFor(() => evaluate('!!document.querySelector("input[aria-invalid=true]")'), 'invalid mailbox feedback')
  assert.equal((await data('settings', 'get', {})).value.mailbox.provider, 'none')

  // Exercise native leave confirmation on navigation, shortcuts and window closure.
  const originalDialog = dialog.showMessageBox
  let response = 0, confirmations = 0
  dialog.showMessageBox = async () => { confirmations++; return { response, checkboxChecked: false } }
  try {
    const before = await read()
    await evaluate(`document.querySelector('.ui-sidebar button[aria-label="Ask AI"]').click()`)
    await waitFor(() => confirmations > 0, 'sidebar honors unsaved settings confirmation')
    assert.equal(active(await read()).targetId, active(before).targetId)
    await call('navigate', 'app://ai')
    assert.equal(active(await read()).targetId, active(before).targetId)
    await call('back')
    await call('createTab')
    await call('closeTab', before.activeTabId)
    assert.equal(active(await read()).targetId, active(before).targetId)
    const count = confirmations
    shortcut(window.webContents, 'T', [process.platform === 'darwin' ? 'meta' : 'control'])
    await waitFor(() => confirmations > count, 'unsaved shortcut confirmation')
    const closeCount = confirmations
    window.close()
    await waitFor(() => confirmations > closeCount, 'unsaved window close confirmation')
    assert.equal(window.isDestroyed(), false)
    response = 1
    await evaluate(`document.querySelector('.ui-sidebar button[aria-label="Ask AI"]').click()`)
    await waitState(state => active(state).destination.page === 'ai', 'discard settings')
  } finally { dialog.showMessageBox = originalDialog }

  await call('navigate', 'app://settings'); await formsReady(); await openForms()
  assert.equal(await evaluate('document.querySelector("[data-settings-mailbox] select").value'), 'none')
  await field('[data-settings-mailbox] select', 'gmail', 'select')
  assert.equal(await evaluate('document.querySelector("[data-settings-mailbox] input").value'), 'https://mail.google.com/')
  await submit(3)
  await waitFor(async () => (await data('settings', 'get', {})).value.mailbox.provider === 'gmail', 'saved mailbox')
  // Cancel network loading: verify routing without relying on an external website.
  const webSession = session.fromPartition('persist:job-agent-browser')
  webSession.webRequest.onBeforeRequest({ urls: ['https://mail.google.com/*'] }, (_details, callback) => callback({ cancel: true }))
  const mailboxNavigation = call('navigate', 'app://inbox').catch(() => {})
  await waitState(state => active(state).url === 'https://mail.google.com/', 'Inbox routes to saved webmail')
  assert.equal(active(await read()).destination.surface, 'inbox')
  assert.equal(await evaluate('!!document.querySelector(".tab-strip, .browser-controls, .address-form")'), false)
  const webmail = views().find(view => view.webContents.getURL().startsWith('https://mail.google.com')) || views().at(-1)
  webmail.webContents.stop()
  await mailboxNavigation
  webSession.webRequest.onBeforeRequest(null)
  await data('settings', 'savePreferences', { mailbox: { provider: 'none', url: '' } })
  await call('navigate', 'app://inbox')
  await waitFor(() => evaluate('document.body.innerText.includes("Open Settings")'), 'unconfigured Inbox guidance')
  await require('./inbox-smoke.cjs')({ window, call, read, active, evaluate, waitFor, waitState, views, shortcut, origin })

  await call('navigate', 'app://settings'); await formsReady(); await openForms()
  const status = (await data('secrets', 'hasProviderKey', { provider: 'openai' })).value
  if (status.available) {
    await field('.settings-page input[type=password]', 'smoke-key-disposable')
    await submit(2)
    await waitFor(async () => (await data('secrets', 'hasProviderKey', { provider: 'openai' })).value.configured, 'encrypted key save')
    await waitFor(() => evaluate('document.querySelector("input[type=password]").value === ""'), 'key cleared from UI')
    const file = readFileSync(resolve(process.env.JOB_BROWSER_SMOKE_DATA, 'secrets.enc'), 'utf8')
    assert.equal(file.includes('smoke-key-disposable'), false)
    assert.equal(safeStorage.decryptString(Buffer.from(JSON.parse(file).providers.openai, 'base64')), 'smoke-key-disposable')
    await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent === "Delete key").click()')
    await waitFor(() => evaluate('document.querySelector("dialog:has(.ui-button--danger)").open'), 'delete confirmation dialog')
    await evaluate('document.querySelector("dialog .ui-button--danger").click()')
    await waitFor(async () => !(await data('secrets', 'hasProviderKey', { provider: 'openai' })).value.configured, 'key deletion')
  }
  await call('navigate', 'app://ai')
  // Leave a disposable fixture for the next process's startup-recovery smoke.
  await data('settings', 'savePreferences', { language: 'zh-CN', theme: 'dark', mailbox: { provider: 'custom', url: 'https://example.invalid/mail' } })
  if (status.available) await data('secrets', 'saveProviderKey', { provider: 'openai', apiKey: 'smoke-key-restart' })
  console.log('Settings smoke passed: real forms, bilingual persistence/reload, responsive geometry, validation, leave guards, Inbox routing and encrypted-key lifecycle.')
}
