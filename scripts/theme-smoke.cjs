const assert = require('node:assert/strict')
const { BrowserWindow, dialog, nativeTheme } = require('electron')
const { chmodSync, mkdirSync, statSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

module.exports = async function themeSmoke({ window, call, read, active, evaluate, waitFor, waitState, views, origin, field, submit, formsReady, capture, data }) {
  const selector = '.settings-page form:not([data-audit-filters]) select:nth-of-type(1)'
  const appearance = '.settings-fields .ui-field:nth-child(2) select'
  const applied = theme => waitFor(() => evaluate(`document.documentElement.dataset.theme === '${theme}' && getComputedStyle(document.documentElement).colorScheme === '${theme}'`), `applied ${theme}`)
  const save = async theme => {
    await field(appearance, theme, 'select')
    await submit(0)
    await waitFor(() => evaluate("document.querySelector('.settings-page form:not([data-audit-filters]) button[type=submit]').disabled && document.querySelector('.settings-page form:not([data-audit-filters]) button[type=submit]').textContent === 'Save changes'"), 'theme form saved')
    assert.equal((await data('settings', 'get', {})).value.theme, theme)
    if (theme !== 'system') await applied(theme)
  }
  const geometry = () => evaluate(`(() => {
    const properties = ['padding', 'margin', 'gap', 'fontFamily', 'fontSize', 'lineHeight', 'fontWeight', 'borderRadius', 'borderWidth', 'transitionDuration', 'animationDuration'];
    return [...document.querySelectorAll('.ui-select, .ui-input, .ui-section-card, .ui-feature-card, .ui-icon-box, .ui-navigation-item, .tab-strip, .browser-controls, .address-form')].map(node => {
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      return { className: node.className, rect: [rect.x, rect.y, rect.width, rect.height], styles: properties.map(property => style[property]) };
    });
  })()`)
  const change = async theme => {
    const before = await read()
    assert.equal((await data('settings', 'savePreferences', { theme })).ok, true)
    await applied(theme)
    const after = await read()
    assert.deepEqual(after.tabs, before.tabs, 'Theme updates preserve destinations, targets and history flags')
    assert.equal(after.activeTabId, before.activeTabId)
  }

  assert.equal(await evaluate(`document.querySelector('${selector}').value`), 'en')
  assert.equal(await evaluate(`document.querySelector('${appearance}').disabled`), false)
  // Draft selection neither changes the saved theme nor applies a preview; leave protection still works.
  await field(appearance, 'dark', 'select')
  assert.equal((await data('settings', 'get', {})).value.theme, 'light')
  await applied('light')
  const originalDialog = dialog.showMessageBox
  try {
    const before = active(await read()).targetId
    dialog.showMessageBox = async () => ({ response: 0 })
    await call('navigate', 'app://home')
    assert.equal(active(await read()).targetId, before)
    dialog.showMessageBox = async () => { nativeTheme.emit('updated'); return { response: 1 } }
    await call('navigate', 'app://home')
    assert.equal(active(await read()).destination.page, 'home', 'Theme notifications do not invalidate confirmed navigation')
  } finally { dialog.showMessageBox = originalDialog }
  await call('navigate', 'app://settings'); await formsReady()
  assert.equal(await evaluate(`document.querySelector('${appearance}').value`), 'light')

  if (process.getuid?.() !== 0) {
    const directory = process.env.JOB_BROWSER_SMOKE_DATA, permissions = statSync(directory).mode & 0o777
    try {
      chmodSync(directory, 0o500)
      await field(appearance, 'dark', 'select'); await submit(0)
      await waitFor(() => evaluate('document.body.innerText.includes("Changes could not be saved. Your previous settings are preserved.")'), 'theme save failure feedback')
      assert.equal((await data('settings', 'get', {})).value.theme, 'light')
      await applied('light')
    } finally { chmodSync(directory, permissions) }
  }

  await save('dark')
  await capture('settings-dark.png')
  const originalSize = window.getContentSize(), originalMinimum = window.getMinimumSize()
  window.setMinimumSize(320, 320)
  try {
    for (const width of [320, 640, 1200]) {
      window.setContentSize(width, 820)
      await waitFor(() => evaluate(`window.innerWidth === ${width}`), `theme viewport ${width}`)
      await save('light')
      const light = await geometry()
      await save('dark')
      assert.deepEqual(await geometry(), light, `Settings color-only geometry at ${width}px`)
      assert.equal(await evaluate('document.querySelector(".settings-page").scrollWidth > document.querySelector(".settings-page").clientWidth'), false)
      if (width === 320) await capture('settings-dark-narrow.png')
    }
    await call('navigate', 'app://home')
    await waitFor(() => evaluate('document.querySelectorAll(".home-card").length === 9'), 'theme Home grid')
    for (const width of [320, 640, 1200]) {
      window.setContentSize(width, 820)
      await waitFor(() => evaluate(`window.innerWidth === ${width}`), `Home theme viewport ${width}`)
      await change('light')
      const light = await geometry()
      await change('dark')
      assert.deepEqual(await geometry(), light, `Home color-only geometry at ${width}px`)
      assert.equal(await evaluate('document.querySelector(".home-page").scrollWidth > document.querySelector(".home-page").clientWidth'), false)
    }
    await capture('home-dark.png')
  } finally { window.setContentSize(...originalSize); window.setMinimumSize(...originalMinimum) }

  // Existing/new remote views follow native color preference without injected CSS or scripts.
  await call('navigate', `${origin}/theme`)
  await waitState(state => !active(state).isLoading, 'theme web fixture')
  await waitFor(() => views().some(view => view.getVisible()), 'theme web view visible')
  const view = views().find(view => view.getVisible()), bounds = view.getBounds()
  await change('light')
  const chrome = await geometry()
  await change('dark')
  assert.deepEqual(await geometry(), chrome, 'Browser chrome geometry unchanged')
  assert.deepEqual(view.getBounds(), bounds, 'Native bounds unchanged')
  assert.equal(await view.webContents.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches"), true)
  await capture('browser-dark.png')
  await call('navigate', 'app://settings'); await formsReady()
  await save('system')
  const target = active(await read()).targetId
  // Simulate native appearance updates while the persisted preference remains system.
  nativeTheme.themeSource = 'light'
  await applied('light')
  nativeTheme.themeSource = 'dark'
  await applied('dark')
  assert.equal((await data('settings', 'get', {})).value.theme, 'system')
  assert.equal(active(await read()).targetId, target)
  assert.equal(await evaluate(`document.querySelector('${appearance}').value`), 'system')
  await save('light')
  assert.equal(nativeTheme.themeSource, 'light')
  nativeTheme.emit('updated')
  await applied('light')

  // The unchanged standalone gallery follows the system by CSS; explicit attributes allow QA of both palettes.
  const gallery = new BrowserWindow({ show: false, width: 1200, height: 820 })
  gallery.webContents.setBackgroundThrottling(false)
  try {
    await gallery.loadFile(resolve(__dirname, '../docs/components/job-browser-component-library-8px.html'))
    const inspect = theme => gallery.webContents.executeJavaScript(`(async () => {
      document.documentElement.dataset.theme = '${theme}';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return [...document.querySelectorAll('body *')].map(node => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        return [rect.x, rect.y, rect.width, rect.height, style.padding, style.margin, style.gap, style.fontSize, style.lineHeight, style.borderRadius, style.borderWidth, style.animationDuration];
      });
    })()`)
    assert.deepEqual(await inspect('dark'), await inspect('light'), 'All gallery elements keep identical geometry')
    await inspect('dark')
    await gallery.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 200))')
    mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
    writeFileSync(resolve(__dirname, '../.cache/gallery-dark.png'), (await gallery.capturePage()).toPNG())
  } finally { gallery.destroy() }
  console.log('Theme smoke passed: saved/draft themes, system updates, unchanged navigation, 320/640/1200px geometry, native color preference and gallery geometry.')
}
