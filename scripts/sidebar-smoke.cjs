const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { app } = require('electron')

module.exports = async function sidebarSmoke({ window, call, read, active, evaluate, waitFor, waitState, views, shortcut }) {
  const pages = [['Home', 'home'], ['Find Jobs', 'find'], ['Tailor Resume', 'resume'], ['Interview Prep', 'interview'], ['Applications', 'applications'],
    ['Inbox', 'inbox'], ['My Profile', 'profile'], ['Browser', 'browser'], ['Ask AI', 'ai'], ['Settings', 'settings']]
  const select = label => evaluate(`document.querySelector('.ui-sidebar button[aria-label=${JSON.stringify(label)}]').click()`)
  const current = label => waitFor(() => evaluate(`document.querySelector('.ui-sidebar [aria-current=page]')?.getAttribute('aria-label') === ${JSON.stringify(label)}`), 'active sidebar item')
  await call('navigate', 'app://home')
  await waitFor(() => evaluate('document.querySelectorAll(".ui-sidebar button").length === 10'), 'all sidebar destinations')
  for (const [label, page] of pages) {
    await select(label)
    await waitState(state => active(state).destination.page === page, `sidebar ${label}`)
    await current(label)
    assert.equal(await evaluate('document.querySelectorAll(".ui-sidebar [aria-current=page]").length'), 1)
    assert.equal(await evaluate('!!document.querySelector(".tab-strip")'), page === 'browser')
    assert(views().every(view => !view.getVisible()))
  }
  await select('Home')
  await current('Home')
  // Native keyboard activation uses the central navigation control's accessible label.
  window.show()
  if (process.platform === 'darwin') app.focus({ steal: true })
  window.focus()
  // Verify native key delivery through DOM focus and the resulting destination.
  window.webContents.focus()
  await evaluate('document.querySelector(".ui-sidebar button[aria-label=Applications]").focus()')
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Applications')
  shortcut(window.webContents, 'Space', [])
  await waitState(state => active(state).destination.page === 'applications', 'keyboard sidebar navigation')
  await current('Applications')
  await select('Home')
  const originalSize = window.getContentSize(), originalMinimum = window.getMinimumSize()
  const capture = async name => {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
    writeFileSync(resolve(__dirname, '../.cache', name), (await window.capturePage()).toPNG())
  }
  window.setMinimumSize(320, 320)
  try {
    for (const width of [320, 640, 960, 968, 1200]) {
      window.setContentSize(width, 820)
      await waitFor(() => evaluate(`innerWidth === ${width}`), `sidebar viewport ${width}`)
      const expected = width <= 960 ? 64 : 208
      const geometry = await evaluate(`(() => {
        const sidebar = document.querySelector('.ui-sidebar'), content = document.querySelector('.app-content');
        return { width: sidebar.getBoundingClientRect().width, x: content.getBoundingClientRect().x,
          labelVisible: getComputedStyle(document.querySelector('.ui-navigation-label')).display !== 'none',
          overflow: document.querySelector('.app-shell').scrollWidth > innerWidth,
          names: [...sidebar.querySelectorAll('button')].every(button => button.getAttribute('aria-label') && button.title) };
      })()`)
      assert.deepEqual(geometry, { width: expected, x: expected, labelVisible: width > 960, overflow: false, names: true })
      if (width === 320) await capture('sidebar-compact.png')
      if (width === 1200) await capture('sidebar-home.png')
    }
    window.setContentSize(640, 420)
    await waitFor(() => evaluate('innerHeight === 420'), 'short sidebar viewport')
    assert.equal(await evaluate('document.querySelector(".ui-sidebar-footer").getBoundingClientRect().bottom <= innerHeight'), true)
    await select('Settings'); await current('Settings')
    await waitFor(() => evaluate('document.querySelectorAll(".settings-page form:not([data-audit-filters])").length === 4'), 'Settings reachable in compact sidebar')
    await select('Home')
  } finally { window.setContentSize(...originalSize); window.setMinimumSize(...originalMinimum) }
  console.log('Sidebar smoke passed: all destinations, active state, keyboard activation, compact/wide geometry, accessible names and short-window reachability.')
}
