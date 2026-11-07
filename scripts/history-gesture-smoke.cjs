const assert = require('node:assert/strict')
const native = require('./native-views.cjs')
const { Menu } = require('electron')

module.exports = async function gestureSmoke({ window, call, read, active, evaluate, waitFor, waitState, views, origin }) {
  await call('createTab')
  const tabId = (await read()).activeTabId
  const originalPopup = Menu.prototype.popup
  let menus = 0, openedMenu
  Menu.prototype.popup = function () { menus++; openedMenu = this }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  try {
    await call('navigate', `${origin}/gesture-one`)
    await call('navigate', `${origin}/gesture-two`)
    const view = views().find(view => view.webContents.getURL() === `${origin}/gesture-two`), contents = view.webContents
    contents.setBackgroundThrottling(false)
    await waitFor(() => view.getVisible(), 'gesture content visible')
    const surface = native.parent(window, view), fixed = surface.getBounds()
    const chrome = await evaluate('document.querySelector(".browser-controls").getBoundingClientRect().bottom')
    const indicator = surface.children.find(child => child !== view && child.webContents)
    assert(indicator, 'Native history arrow is separate from website content')
    await waitFor(() => indicator.webContents.getTitle() === 'History indicator', 'history arrow ready')
    const fixedContent = view.getBounds()
    async function arrow(direction, ready = true, available = true) {
      await waitFor(async () => indicator.getVisible() && await indicator.webContents.executeJavaScript(
        `document.documentElement.dataset.direction === '${direction}' && document.documentElement.dataset.ready === '${ready}' && document.documentElement.dataset.available === '${available}'`
      ), `${direction} arrow feedback`)
      assert.deepEqual(view.getBounds(), fixedContent, 'Website content stays fixed during gestures')
      assert.deepEqual(surface.getBounds(), fixed)
      assert.equal(await evaluate('document.querySelector(".browser-controls").getBoundingClientRect().bottom'), chrome)
      const bounds = indicator.getBounds()
      assert(direction === 'back' ? bounds.x < fixed.width / 2 : bounds.x > fixed.width / 2, 'Arrow appears at the matching edge')
    }
    async function wheel(deltaX, deltaY = 0, x = 320, y = 300) {
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY })
    }
    // sendInputEvent bypasses Electron's native before-mouse hook; replay that hook explicitly.
    async function rightDrag(distance, available = true) {
      contents.focus()
      contents.emit('before-mouse-event', { preventDefault() {} }, { type: 'mouseDown', button: 'right', x: 320, y: 300, clickCount: 1 })
      contents.emit('before-mouse-event', { preventDefault() {} }, { type: 'mouseMove', x: 320 + distance, y: 300, modifiers: ['rightbuttondown'] })
      await arrow(distance > 0 ? 'back' : 'forward', available && Math.abs(distance) >= Math.min(96, fixed.width / 4), available)
      contents.emit('before-mouse-event', { preventDefault() {} }, { type: 'mouseUp', button: 'right', x: 320 + distance, y: 300, clickCount: 1 })
      assert.equal(indicator.getVisible(), false, 'Release dismisses arrow immediately')
    }
    const cover = surface.children.find(child => child !== view && !child.webContents)
    const originalPrepare = contents.executeJavaScriptInIsolatedWorld
    let releaseFrame
    contents.executeJavaScriptInIsolatedWorld = async function (...args) {
      await new Promise(resolve => { releaseFrame = resolve })
      return originalPrepare.apply(this, args)
    }
    await rightDrag(140)
    await waitFor(() => !!releaseFrame && cover.getVisible(), 'history target is held behind its gray cover')
    assert.equal(surface.getVisible(), true, 'History must retain the native gray surface across React acknowledgment')
    assert.equal(view.getBounds().x, 0, 'History navigation retains the fixed content position')
    await pause(80)
    assert.equal(cover.getVisible(), true, 'Old/partially painted target cannot be revealed early')
    contents.executeJavaScriptInIsolatedWorld = originalPrepare
    releaseFrame()
    await waitFor(() => !cover.getVisible(), 'target compositor frame reveals directly')
    await waitState(state => active(state).url === `${origin}/gesture-one`, 'right drag Back')
    await waitFor(() => view.getVisible() && view.getBounds().x === 0, 'content reset after Back')
    assert.equal(menus, 0, 'History drag must not open a context menu')
    await pause(360)
    await rightDrag(-140)
    await waitState(state => active(state).url === `${origin}/gesture-two`, 'left drag Forward')
    await waitFor(() => view.getVisible() && view.getBounds().x === 0, 'content reset after Forward')
    await pause(360)
    await rightDrag(32)
    await waitFor(() => view.getBounds().x === 0, 'short drag leaves content fixed')
    assert.equal(active(await read()).url, `${origin}/gesture-two`)
    await rightDrag(-140, false)
    assert.equal(active(await read()).url, `${origin}/gesture-two`, 'Unavailable forward arrow cannot navigate')
    contents.emit('before-mouse-event', { preventDefault() {} }, { type: 'mouseDown', button: 'right', x: 10, y: fixed.height / 2 })
    contents.emit('before-mouse-event', { preventDefault() {} }, { type: 'mouseMove', x: 150, y: fixed.height / 2, modifiers: ['rightbuttondown'] })
    await arrow('back')
    for (const type of ['mouseMove', 'mouseUp']) indicator.webContents.emit('before-mouse-event', { preventDefault() {} }, {
      type, button: 'right', x: 24, y: 32, modifiers: ['rightbuttondown']
    })
    assert.equal(indicator.getVisible(), false, 'Reversing and releasing over the arrow cancels the gesture')
    assert.equal(active(await read()).url, `${origin}/gesture-two`)
    await pause(360)
    await wheel(-120)
    await arrow('back')
    assert.deepEqual(surface.getBounds(), fixed)
    await waitState(state => active(state).url === `${origin}/gesture-one`, 'trackpad Back')
    await waitFor(() => view.getVisible() && view.getBounds().x === 0, 'wheel Back settles')
    await pause(360)
    await wheel(120)
    await arrow('forward')
    await waitState(state => active(state).url === `${origin}/gesture-two`, 'trackpad Forward')
    await waitFor(() => view.getVisible() && view.getBounds().x === 0, 'wheel Forward settles')
    await pause(360)
    const priorTab = active(await read()).id
    await contents.executeJavaScript('window.__refreshSentinel = true')
    await evaluate('document.querySelector(".browser-controls button[aria-label=Refresh]").click()')
    await waitFor(() => cover.getVisible(), 'toolbar refresh uses the gray cover')
    await waitFor(async () => !cover.getVisible() && !(await contents.executeJavaScript('!!window.__refreshSentinel')), 'toolbar refresh completes in its own tab')
    assert.equal(active(await read()).id, priorTab)
    assert.equal(active(await read()).url, `${origin}/gesture-two`)
    contents.focus()
    for (const type of ['mouseDown', 'mouseUp']) contents.sendInputEvent({ type, button: 'right', x: 500, y: 300, clickCount: 1 })
    await waitFor(() => !!openedMenu, 'native page context menu')
    const refresh = openedMenu.getMenuItemById('browser-refresh')
    assert.equal(refresh.label, 'Refresh'); assert(refresh.enabled)
    await contents.executeJavaScript('window.__refreshSentinel = true')
    refresh.click(refresh, window, {})
    await waitFor(async () => !cover.getVisible() && !(await contents.executeJavaScript('!!window.__refreshSentinel')), 'native menu refresh completes')
    assert.equal(active(await read()).id, priorTab)
    assert.equal(active(await read()).url, `${origin}/gesture-two`)
    await contents.executeJavaScript(`document.body.insertAdjacentHTML('beforeend', '<div id="scroller" style="position:fixed;left:200px;top:100px;width:400px;height:160px;overflow:auto"><div style="width:1200px;height:120px">Horizontal content</div></div><div style="height:2400px">Vertical content</div>')`)
    await wheel(140, 0, 300, 140)
    await pause(400)
    assert((await contents.executeJavaScript('document.querySelector("#scroller").scrollLeft')) > 0, 'Horizontal webpage scroller owns its gesture')
    assert.equal(active(await read()).url, `${origin}/gesture-two`)
    assert.equal(view.getBounds().x, 0)
    await wheel(0, 140, 700, 300); await pause(400)
    assert((await contents.executeJavaScript('scrollY')) > 0, 'Vertical scrolling passes through')
    await contents.executeJavaScript('scrollTo(0, 0)')
    await contents.executeJavaScript(`document.querySelector('#scroller').style.overscrollBehaviorX = 'contain'; document.querySelector('#scroller').scrollLeft = 0`)
    await wheel(-140, 0, 300, 140); await pause(400)
    assert.equal(active(await read()).url, `${origin}/gesture-two`, 'CSS overscroll containment blocks history navigation')
    await contents.executeJavaScript("window.dispatchEvent(new WheelEvent('wheel', {deltaX:-200, cancelable:true, bubbles:true}))")
    await pause(400)
    assert.equal(view.getBounds().x, 0, 'Website scripts cannot synthesize navigation gestures')
    assert.equal(active(await read()).url, `${origin}/gesture-two`)

    await wheel(-120)
    await arrow('back')
    await call('navigate', 'app://ai')
    await pause(400)
    assert.equal(active(await read()).destination.page, 'ai')
    assert.equal(view.getBounds().x, 0)
    assert.equal(view.getVisible(), false)
    assert.equal(indicator.getVisible(), false, 'Workspace switch cancels arrow feedback')
    await call('navigate', 'app://browser')
    await waitFor(() => view.getVisible(), 'restored after cancelled gesture')
    assert.equal(active(await read()).url, `${origin}/gesture-two`)
    assert.equal(await contents.executeJavaScript('typeof window.browser + ":" + typeof require'), 'undefined:undefined')
    console.log('History gesture smoke passed: right-button and trackpad navigation, edge arrows, readiness, fixed content/chrome, gray first-frame reveal, toolbar/menu refresh, scroll priority, cancellation and isolated preload.')
  } finally {
    Menu.prototype.popup = originalPopup
    await call('closeTab', tabId)
  }
}
