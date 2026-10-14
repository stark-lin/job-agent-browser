const assert = require('node:assert/strict')
const { dialog, safeStorage, session } = require('electron')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

module.exports = async function settingsSmoke({ window, call, read, active, evaluate, waitFor, waitState, views, shortcut, origin }) {
  const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const formsReady = () => waitFor(() => evaluate('document.querySelectorAll(".settings-page form:not([data-audit-filters])").length === 4'), 'Settings forms ready')
  const field = async (selector, value, type = 'input') => {
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(${type === 'select' ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event(${JSON.stringify(type === 'select' ? 'change' : 'input')}, { bubbles: true }));
    })()`)
    await frames()
  }
  const data = async (group, method, input) => evaluate(`window.data.${group}.${method}(${JSON.stringify(input)})`)
  const submit = index => evaluate(`document.querySelectorAll('.settings-page form:not([data-audit-filters])')[${index}].requestSubmit()`)
  const capture = async name => {
    mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
    await frames()
    writeFileSync(resolve(__dirname, '../.cache', name), (await window.capturePage()).toPNG())
  }
  await call('navigate', 'app://settings')
  await formsReady()
  assert.equal(await evaluate('!!document.querySelector(".tab-strip, .address-form")'), false)
  assert(views().every(view => !view.getVisible()))
  const geometry = await evaluate(`(() => {
    const section = document.querySelector('.ui-section-card'), input = document.querySelector('.ui-input');
    return { padding: getComputedStyle(section).padding, radius: getComputedStyle(section).borderRadius, height: input.getBoundingClientRect().height,
      labels: [...document.querySelectorAll('.ui-field-label')].every(label => !!document.getElementById(label.htmlFor)) };
  })()`)
  assert.deepEqual(geometry, { padding: '24px', radius: '16px', height: 40, labels: true })
  await require('./audit-viewer-smoke.cjs')({ window, call, evaluate, waitFor, field, data, capture })
  await formsReady()
  await require('./theme-smoke.cjs')({ window, call, read, active, evaluate, waitFor, waitState, views, origin, field, submit, formsReady, capture, data })
  await capture('settings-en.png')

  // Change through React controls and the production IPC, then reload the renderer.
  await field('.settings-page form:not([data-audit-filters]) select', 'zh-CN', 'select')
  await submit(0)
  await waitFor(() => evaluate('document.documentElement.lang === "zh-CN" && document.querySelector("h1").textContent === "设置"'), 'saved Chinese UI')
  await waitState(state => state.language === 'zh-CN' && active(state).title === '设置', 'Main language follows saved preference')
  assert.equal(await evaluate('document.querySelector("[data-audit-viewer] h2").textContent'), '审计日志')
  assert.equal(await evaluate('document.querySelector("[data-audit-viewer] button[type=submit]").textContent'), '查询日志')
  assert.equal((await data('settings', 'get', {})).value.language, 'zh-CN')
  await capture('settings-zh.png')
  const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve))
  window.webContents.reload()
  await loaded
  await formsReady()
  await waitFor(() => evaluate('document.documentElement.lang === "zh-CN"'), 'Chinese preference after reload')

  const originalSize = window.getContentSize(), originalMinimum = window.getMinimumSize()
  window.setMinimumSize(320, 320)
  try {
    for (const width of [320, 640, 1200]) {
      window.setContentSize(width, 820)
      await waitFor(() => evaluate(`window.innerWidth === ${width}`), `Settings viewport ${width}`)
      assert.equal(await evaluate('document.querySelector(".settings-page").scrollWidth > document.querySelector(".settings-page").clientWidth'), false)
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".settings-fields")).gridTemplateColumns.split(" ").length'), width <= 640 ? 1 : 2)
      if (width === 320) await capture('settings-narrow.png')
    }
  } finally { window.setContentSize(...originalSize); window.setMinimumSize(...originalMinimum) }

  await field('.settings-page form:not([data-audit-filters]) select', 'en', 'select')
  await submit(0)
  await waitFor(() => evaluate('document.documentElement.lang === "en"'), 'English restored')
  // Invalid URLs receive field feedback and never persist.
  await field('.settings-sections > section:nth-child(3) select', 'custom', 'select')
  await field('.settings-sections > section:nth-child(3) input', 'https://user:password@example.com')
  await submit(3)
  await waitFor(() => evaluate('!!document.querySelector("input[aria-invalid=true]")'), 'invalid mailbox feedback')
  assert.equal((await data('settings', 'get', {})).value.mailbox.provider, 'none')

  // Exercise native leave confirmation on navigation, shortcuts and window closure.
  const originalDialog = dialog.showMessageBox
  let response = 0, confirmations = 0
  dialog.showMessageBox = async () => { confirmations++; return { response, checkboxChecked: false } }
  try {
    const before = await read()
    await evaluate('document.querySelector(".ui-sidebar button[aria-label=Home]").click()')
    await waitFor(() => confirmations > 0, 'sidebar honors unsaved settings confirmation')
    assert.equal(active(await read()).targetId, active(before).targetId)
    await call('navigate', 'app://home')
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
    await evaluate('document.querySelector(".ui-sidebar button[aria-label=Home]").click()')
    await waitState(state => active(state).destination.page === 'home', 'discard settings')
  } finally { dialog.showMessageBox = originalDialog }

  await call('navigate', 'app://settings'); await formsReady()
  assert.equal(await evaluate('document.querySelector(".settings-sections > section:nth-child(3) select").value'), 'none')
  await field('.settings-sections > section:nth-child(3) select', 'gmail', 'select')
  assert.equal(await evaluate('document.querySelector(".settings-sections > section:nth-child(3) input").value'), 'https://mail.google.com/')
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

  await call('navigate', 'app://settings'); await formsReady()
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
  await call('navigate', 'app://home')
  // Leave a disposable fixture for the next process's startup-recovery smoke.
  await data('settings', 'savePreferences', { language: 'zh-CN', theme: 'dark', mailbox: { provider: 'custom', url: 'https://example.invalid/mail' } })
  if (status.available) await data('secrets', 'saveProviderKey', { provider: 'openai', apiKey: 'smoke-key-restart' })
  console.log('Settings smoke passed: real forms, bilingual persistence/reload, responsive geometry, validation, leave guards, Inbox routing and encrypted-key lifecycle.')
}
