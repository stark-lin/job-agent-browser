const assert = require('node:assert/strict')
const { BrowserWindow, clipboard, Menu } = require('electron')

module.exports = async function browserCopySmoke({ window, call, read, evaluate, waitFor, pageFor, origin }) {
  const selector = JSON.stringify('button[aria-label="Copy Webpage"]')
  const toolbarButton = `document.querySelector(${selector})`
  const clickToolbar = () => evaluate(`${toolbarButton}.click()`)
  const priorText = await clipboard.readText()
  const sentinel = 'clipboard before Copy Webpage'
  const originalPopup = Menu.prototype.popup
  let menu
  Menu.prototype.popup = function () { menu = this }
  try {
    await call('createTab')
    await clipboard.writeText(sentinel)
    await waitFor(() => evaluate(`${toolbarButton}?.disabled`), 'copy disabled in a new tab')
    await assert.rejects(call('copyWebpage'), /Could not copy webpage text/)
    assert.equal(await clipboard.readText(), sentinel)

    const firstTab = (await read()).activeTabId
    await call('navigate', `${origin}/copy-fixture`)
    const view = pageFor(`${origin}/copy-fixture`), contents = view.webContents
    await waitFor(() => view.getVisible() && evaluate(`${toolbarButton}?.disabled === false`), 'copy fixture presented')
    await waitFor(() => contents.executeJavaScript("document.querySelector('#dynamic-copy')?.textContent === 'Dynamic text'"), 'dynamic fixture text')
    assert.equal(await contents.executeJavaScript("getComputedStyle(document.querySelector('h1')).userSelect"), 'none')
    assert.equal(await contents.executeJavaScript("document.dispatchEvent(new Event('copy', {cancelable:true}))"), false)
    await clickToolbar()
    await waitFor(() => evaluate('document.querySelector(".browser-controls [role=status]")?.textContent === "Copied"'), 'toolbar copy feedback')
    assert.equal(await clipboard.readText(), [
      'Menu', 'Lead', 'Copy test', 'Between', 'First line', 'Second line', 'Item', 'Tail',
      'Role Engineer', 'Hidden text', 'Dynamic text', 'Footer'
    ].join('\n'))
    assert.equal(await evaluate(`${toolbarButton}.previousElementSibling.matches('.address-form')`), true)

    contents.focus()
    for (const type of ['mouseDown', 'mouseUp']) contents.sendInputEvent({ type, button: 'right', x: 300, y: 150, clickCount: 1 })
    await waitFor(() => !!menu, 'copy menu')
    const menuCopy = menu.getMenuItemById('browser-copy-webpage')
    assert.equal(menuCopy.label, 'Copy Webpage')
    assert(menuCopy.enabled)
    await call('createTab')
    await call('navigate', `${origin}/other-copy-tab`)
    const secondView = pageFor(`${origin}/other-copy-tab`)
    await waitFor(() => secondView.getVisible(), 'second copy tab presented')
    menuCopy.click(menuCopy, window, {})
    await waitFor(() => evaluate('document.querySelector(".browser-controls [role=status]")?.textContent === "Copied"'), 'menu copy feedback on the current tab')
    assert.equal(await clipboard.readText(), '/other-copy-tab')

    const outsider = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
    try {
      await outsider.loadURL('data:text/html,<h1>Untrusted copy smoke document</h1>')
      await assert.rejects(outsider.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('browser:copy-webpage')"), /Untrusted IPC sender/)
    } finally {
      outsider.destroy()
    }

    const write = clipboard.writeText
    try {
      clipboard.writeText = async () => { throw new Error('Simulated clipboard failure') }
      menuCopy.click(menuCopy, window, {})
      await waitFor(() => evaluate('document.querySelector(".browser-controls [role=alert]")?.textContent === "Could not copy webpage text."'), 'menu clipboard error')
      assert.equal(await clipboard.readText(), '/other-copy-tab')
    } finally {
      clipboard.writeText = write
    }

    await clipboard.writeText(sentinel)
    await call('navigate', `${origin}/copy-empty`)
    await waitFor(() => evaluate(`${toolbarButton}?.disabled === false`), 'loaded textless page')
    await clickToolbar()
    await waitFor(() => evaluate('document.querySelector(".browser-controls [role=alert]")?.textContent === "Could not copy webpage text."'), 'empty page copy error')
    assert.equal(await clipboard.readText(), sentinel)
    await assert.rejects(call('navigate', `${origin}/failure`))
    await waitFor(() => evaluate(`${toolbarButton}?.disabled`), 'failed load disables copy')
    await assert.rejects(call('copyWebpage'), /Could not copy webpage text/)
    assert.equal(await clipboard.readText(), sentinel)
    await call('closeTab', firstTab)
    await call('closeTab', (await read()).activeTabId)
    console.log('Copy Webpage smoke passed: DOM cleanup, dynamic and hidden text, clipboard preservation, toolbar/menu feedback and current-tab targeting.')
  } finally {
    Menu.prototype.popup = originalPopup
    await clipboard.writeText(priorText)
  }
}
