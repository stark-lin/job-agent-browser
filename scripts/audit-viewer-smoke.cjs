const assert = require('node:assert/strict')
const { ipcMain, dialog } = require('electron')
const { randomUUID } = require('node:crypto')

module.exports = async function auditViewerSmoke({ window, call, evaluate, waitFor, field, data, capture }) {
  const root = '[data-audit-viewer]'
  const ready = () => waitFor(() => evaluate(`!!document.querySelector('${root} [data-audit-pagination]')`), 'audit results ready')
  const text = () => evaluate(`document.querySelector('${root}').innerText`)
  const click = label => evaluate(`(() => { const button = [...document.querySelectorAll('${root} button')].find(button => button.textContent === ${JSON.stringify(label)}); button.focus(); button.click(); })()`)
  const input = (name, value, type = 'input') => field(`${root} [name=${name}]`, value, type)
  const search = async () => { await evaluate(`document.querySelector('${root} form').requestSubmit()`); await ready() }
  await ready()
  assert.equal(await evaluate(`document.querySelector('.settings-content').lastElementChild.matches('${root}')`), true)
  const profiles = []
  for (let index = 0; index < 27; index++) {
    const result = await data('profiles', 'createProfile', { name: `PRIVATE_AUDIT_VIEWER_${index}` })
    assert.equal(result.ok, true); profiles.push(result.value.id)
  }
  assert.equal((await data('profiles', 'createProfile', { name: '' })).ok, false)
  const before = (await data('audit', 'list', {})).value.total
  await input('targetType', 'profile', 'select'); await input('status', 'SUCCESS', 'select'); await search()
  assert.equal(await evaluate(`document.querySelectorAll('${root} tbody tr').length`), 25)
  assert((await text()).includes('27 records · Page 1 of 2'))
  await click('Next page'); await ready()
  assert.equal(await evaluate(`document.querySelectorAll('${root} tbody tr').length`), 2)
  assert((await text()).includes('Page 2 of 2'))
  await click('Refresh'); await ready()
  assert((await text()).includes('Page 1 of 2'))
  await click('View details')
  assert.equal(await evaluate(`document.querySelector('${root} dialog').open`), true)
  assert.equal(await evaluate(`document.querySelectorAll('${root} dialog dt').length`), 15)
  assert.equal(await evaluate(`document.querySelector('${root} dialog').innerText.includes('PRIVATE_AUDIT_VIEWER_')`), false)
  assert.equal(await evaluate(`document.activeElement.textContent`), 'Close')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitFor(() => evaluate(`!document.querySelector('${root} dialog').open`), 'audit dialog keyboard dismissal')
  assert.equal(await evaluate(`document.activeElement.textContent`), 'View details')
  await click('Advanced filters')
  await input('targetId', profiles[0]); await search()
  assert.equal(await evaluate(`document.querySelectorAll('${root} tbody tr').length`), 1)
  const entry = (await data('audit', 'list', { targetType: 'profile', targetId: profiles[0], status: 'SUCCESS' })).value.items[0]
  await input('requestId', entry.requestId); await input('transactionId', entry.transactionId); await search()
  assert.equal(await evaluate(`document.querySelectorAll('${root} tbody tr').length`), 1)
  await input('requestId', 'invalid')
  await evaluate(`document.querySelector('${root} form').requestSubmit()`)
  assert.equal(await evaluate(`document.querySelector('${root} [name=requestId]').getAttribute('aria-invalid')`), 'true')
  await input('requestId', ''); await input('transactionId', ''); await input('targetId', randomUUID()); await search()
  assert((await text()).includes('No records match these filters.'))
  await click('Reset'); await ready()
  await input('targetType', 'profile', 'select'); await input('status', 'FAILURE', 'select'); await search()
  assert.equal(await evaluate(`document.querySelectorAll('${root} tbody tr').length`), 1)
  assert((await text()).includes('Failure'))
  await evaluate(`document.querySelector('${root} .ui-table-scroll').scrollIntoView({ block: 'center' })`)
  await capture('audit-viewer-en.png')
  const size = window.getContentSize(), minimum = window.getMinimumSize()
  window.setMinimumSize(320, 320)
  try {
    for (const width of [320, 640, 1200]) {
      window.setContentSize(width, 820)
      await waitFor(() => evaluate(`window.innerWidth === ${width}`), `audit viewport ${width}`)
      assert.equal(await evaluate(`document.querySelector('.settings-page').scrollWidth > document.querySelector('.settings-page').clientWidth`), false)
      assert.equal(await evaluate(`!!document.querySelector('${root} .ui-table-scroll[tabindex="0"]')`), true)
      await click('View details')
      const fits = await evaluate(`(() => { const rect = document.querySelector('${root} dialog').getBoundingClientRect(); return rect.width <= window.innerWidth && rect.height <= window.innerHeight; })()`)
      assert.equal(fits, true)
      await click('Close')
      if (width === 320) { await evaluate(`document.querySelector('${root}').scrollIntoView()`); await capture('audit-viewer-narrow.png') }
    }
  } finally { window.setContentSize(...size); window.setMinimumSize(...minimum) }

  // Test-only wrapper around the existing handler; all non-audit calls keep production behavior.
  const original = ipcMain._invokeHandlers.get('data:call')
  let fault = '', release, delayed
  ipcMain.removeHandler('data:call')
  ipcMain.handle('data:call', (event, group, method, args) => {
    if (group === 'audit' && method === 'list') {
      if (fault === 'failure') return { ok: false, error: 'STORAGE_UNAVAILABLE' }
      if (fault === 'empty') return { ok: true, value: { items: [], total: 0 } }
      if (fault === 'delay') {
        fault = ''; delayed = original(event, group, method, args)
        return new Promise(resolve => { release = () => resolve(delayed) })
      }
    }
    return original(event, group, method, args)
  })
  try {
    fault = 'failure'; await click('Refresh')
    await waitFor(async () => (await text()).includes('Audit records could not be loaded.'), 'audit failure feedback')
    assert.equal(await evaluate('document.querySelector(".settings-page form:not([data-audit-filters]) select").disabled'), false)
    fault = ''; await click('Try again'); await ready()
    fault = 'empty'; await click('Reset'); await ready()
    assert((await text()).includes('No audit records yet.'))
    fault = 'delay'; await click('Refresh')
    await waitFor(() => Boolean(release), 'pending audit read')
    assert((await text()).includes('Loading audit records…'))
    await input('targetType', 'profile', 'select'); await input('status', 'FAILURE', 'select')
    await search()
    const expected = await text()
    release(); release = null
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.equal(await text(), expected, 'Superseded audit response cannot replace newer results')
    await click('Reset'); await ready()
  } finally { release?.(); ipcMain.removeHandler('data:call'); ipcMain.handle('data:call', original) }
  assert.equal((await data('audit', 'list', {})).value.total, before, 'All viewer operations remain read-only')
  const originalDialog = dialog.showMessageBox
  let confirmations = 0
  dialog.showMessageBox = async () => { confirmations++; return { response: 1 } }
  try {
    await input('targetId', profiles[0])
    await call('navigate', 'app://home')
    assert.equal(confirmations, 0, 'Audit filters do not create unsaved preferences')
  } finally { dialog.showMessageBox = originalDialog }
  await call('navigate', 'app://settings'); await ready()
  console.log('Audit Viewer smoke passed: real IPC, filtering/pagination/details, read-only semantics, responsive layout, keyboard, loading/failure/empty states and stale-response rejection.')
}
