const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { app } = require('electron')

module.exports = async function sidebarSmoke({ window, call, active, evaluate, waitFor, waitState, views, shortcut, origin }) {
  const pages = [['Ask AI', 'ai'], ['My Profile', 'profile'], ['Tailor Resume', 'resume'], ['Smart Note', 'knowledge'], ['Add Job', 'find'],
    ['Applications', 'applications'], ['Inbox', 'inbox'], ['Browser', 'browser'], ['Settings', 'settings']]
  const openTooltip = '.ui-navigation-tooltip:popover-open'
  const tooltipText = () => evaluate(`document.querySelector(${JSON.stringify(openTooltip)})?.textContent`)
  const move = (x, y) => window.webContents.sendInputEvent({ type: 'mouseMove', x, y })
  const hover = async label => {
    const { x, y } = await evaluate(`(() => {
      const button = document.querySelector('.ui-sidebar button[aria-label=${JSON.stringify(label)}]');
      const { left, top, width, height } = button.getBoundingClientRect();
      return { x: Math.floor(left + width / 2), y: Math.floor(top + height / 2) };
    })()`)
    move(x, y)
  }
  const select = label => evaluate(`document.querySelector('.ui-sidebar button[aria-label=${JSON.stringify(label)}]').click()`)
  const current = label => waitFor(() => evaluate(`document.querySelector('.ui-sidebar [aria-current=page]')?.getAttribute('aria-label') === ${JSON.stringify(label)}`), 'active sidebar item')
  await call('navigate', 'app://ai')
  await current('Ask AI')
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".ui-sidebar button")].map(button => button.getAttribute("aria-label"))'), pages.map(([label]) => label))
  for (const [label, page] of pages) {
    await select(label)
    await waitState(state => active(state).destination.page === page, `sidebar ${label}`)
    await current(label)
    assert.equal(await evaluate('document.querySelectorAll(".ui-sidebar [aria-current=page]").length'), 1)
    assert.equal(await evaluate('!!document.querySelector(".tab-strip")'), page === 'browser')
    assert(views().every(view => !view.getVisible()))
  }
  await select('Ask AI')
  await current('Ask AI')
  // Native keyboard activation uses the central navigation control's accessible label.
  window.show()
  if (process.platform === 'darwin') app.focus({ steal: true })
  window.focus()
  // Verify native key delivery through DOM focus and the resulting destination.
  window.webContents.focus()
  await hover('Ask AI')
  await waitFor(async () => await tooltipText() === 'Ask AI', 'mouse opens sidebar title')
  assert.deepEqual(await evaluate(`(() => {
    const tooltip = document.querySelector('${openTooltip}');
    const button = document.querySelector('.ui-navigation-item[aria-label="Ask AI"]');
    const tip = tooltip.getBoundingClientRect(), trigger = button.getBoundingClientRect();
    return { rightOfSidebar: tip.left >= 64, centered: Math.abs((tip.top + tip.bottom) - (trigger.top + trigger.bottom)) < 2,
      delay: getComputedStyle(button).getPropertyValue('interest-delay-start') };
  })()`), { rightOfSidebar: true, centered: true, delay: '0s' })
  await hover('My Profile')
  await waitFor(async () => await tooltipText() === 'My Profile', 'moving between icons switches title')
  move(1, 1)
  await waitFor(async () => !await tooltipText(), 'mouse exit dismisses title')
  await evaluate('document.querySelector(".ui-sidebar button[aria-label=Applications]").focus()')
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Applications')
  await waitFor(async () => await tooltipText() === 'Applications', 'keyboard focus opens sidebar title')
  shortcut(window.webContents, 'Escape', [])
  await waitFor(async () => !await tooltipText(), 'Escape dismisses sidebar title')
  shortcut(window.webContents, 'Space', [])
  await waitState(state => active(state).destination.page === 'applications', 'keyboard sidebar navigation')
  await current('Applications')
  await select('Ask AI')
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
      const expected = 64
      const geometry = await evaluate(`(() => {
        const sidebar = document.querySelector('.ui-sidebar'), content = document.querySelector('.app-content');
        return { width: sidebar.getBoundingClientRect().width, x: content.getBoundingClientRect().x,
          iconOnly: [...sidebar.querySelectorAll('button')].every(button => !button.textContent.trim() && button.querySelector('svg')),
          brandAbsent: !document.body.textContent.includes('Job Browser'),
          overflow: document.querySelector('.app-shell').scrollWidth > innerWidth,
          names: [...sidebar.querySelectorAll('button')].every(button => button.getAttribute('aria-label') === document.getElementById(button.getAttribute('interestfor'))?.textContent) };
      })()`)
      assert.deepEqual(geometry, { width: expected, x: expected, iconOnly: true, brandAbsent: true, overflow: false, names: true })
      if (width === 320) await capture('sidebar-compact.png')
      if (width === 1200) await capture('sidebar-ask-ai.png')
    }
    window.setContentSize(640, 420)
    await waitFor(() => evaluate('innerHeight === 420'), 'short sidebar viewport')
    assert.equal(await evaluate('document.querySelector(".ui-sidebar-footer").getBoundingClientRect().bottom <= innerHeight'), true)
    await hover('Settings')
    await waitFor(async () => await tooltipText() === 'Settings', 'footer tooltip in short window')
    assert(await evaluate(`document.querySelector('${openTooltip}').getBoundingClientRect().bottom <= innerHeight`))
    move(1, 1)
    await select('Settings'); await current('Settings')
    await waitFor(() => evaluate('!!document.querySelector("[data-settings-general]") && !!document.querySelector("[data-ai-config]") && !!document.querySelector("[data-settings-mailbox-form]")'), 'Settings reachable in compact sidebar')
    await select('Ask AI')
  } finally { window.setContentSize(...originalSize); window.setMinimumSize(...originalMinimum) }

  await call('navigate', `${origin}/sidebar-tooltip`)
  await waitFor(() => views().some(view => view.getVisible() && view.webContents.getURL().endsWith('/sidebar-tooltip')), 'native browser for sidebar tooltip')
  const nativeTooltip = window.contentView.children.find(view => view.webContents?.getTitle() === 'Navigation tooltip')
  assert(nativeTooltip)
  window.webContents.focus()
  await hover('Settings')
  await waitFor(() => nativeTooltip.getVisible(), 'sidebar tooltip above native browser')
  assert.equal(await nativeTooltip.webContents.executeJavaScript('document.body.textContent'), 'Settings')
  assert.equal(window.contentView.children.at(-1), nativeTooltip)
  move(1, 1)
  await waitFor(() => !nativeTooltip.getVisible(), 'native sidebar tooltip closes on exit')
  await select('Ask AI')
  await current('Ask AI')
  console.log('Sidebar smoke passed: order, navigation, immediate hover and keyboard titles, native overlay, and responsive geometry.')
}
