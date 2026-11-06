const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { clipboard, Menu, session } = require('electron')
const { randomUUID } = require('node:crypto')

const settingsSelector = '[data-settings-smart-paste]'
const settingsField = `${settingsSelector} input`
const titleSelector = '.ui-banner-detail'
const delta = (data, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: data, finish_reason }] })}\n\n`
const finish = (response, content) => response.end(delta({ content }, 'stop') + 'data: [DONE]\n\n')
const fields = `<style>textarea, [contenteditable] { display: block; font: 16px monospace; }</style><label for="field">About me</label><textarea id="field" placeholder="Intro" aria-describedby="help">left OLD right</textarea>
<p id="help">Use a short sentence.</p><input id="password" type="password"><input id="readonly" readonly value="protected">
<div id="editable" contenteditable>left OLD right</div>
<script>
  const field = document.querySelector('#field'), native = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
  let tracked = field.value
  Object.defineProperty(field, 'value', { get: native.get, set(value) { native.set.call(this, value); tracked = this.value } })
  field.addEventListener('input', () => { if (field.value !== tracked) { tracked = field.value; window.observed = tracked } })
  document.querySelector('#editable').addEventListener('input', () => { window.observedEditable = true })
</script>`

module.exports = async function smartPasteSmoke({ window, call, read, active, evaluate, waitFor, views }) {
  const webSession = session.fromPartition('persist:job-agent-browser')
  const data = (group, method, value) => evaluate(`window.data.${group}.${method}(${JSON.stringify(value)})`)
  const original = (await data('settings', 'get', {})).value
  const originalClipboard = await clipboard.readText()
  const menuPopup = Menu.prototype.popup
  const id = randomUUID(), previousSize = window.getContentSize()
  const model = 'smart-paste-fixture', calls = []
  let origin, crossOrigin, menu, popup, respond, serverError
  const server = createServer((request, response) => {
    if (request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><title>Form fixture</title>${fields}
        ${request.url.startsWith('/frame') ? '' : `<iframe id="same" src="${origin}/frame-same" style="width:420px;height:240px"></iframe>
        <iframe id="cross" src="${crossOrigin}/frame-cross?token=hidden" style="width:420px;height:240px"></iframe>`}`)
      return
    }
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      try {
        const input = JSON.parse(body)
        calls.push(input)
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        respond(input, response)
      } catch (error) { serverError = error; response.destroy() }
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  crossOrigin = `http://localhost:${server.address().port}`
  Menu.prototype.popup = function (options) { menu = this; popup = options }
  webSession.webRequest.onBeforeRequest({ urls: ['https://smart-paste.fixture.invalid/*'] }, (details, callback) => {
    callback({ redirectURL: origin + new URL(details.url).pathname })
  })

  const banner = () => window.contentView.children.find(child => child.webContents?.getTitle() === 'Banner')
  const bannerText = view => view.webContents.executeJavaScript(`document.querySelector('${titleSelector}').textContent`)
  const waitBanner = (text) => waitFor(async () => {
    if (serverError) throw serverError
    const view = banner()
    return view?.getVisible() && (await bannerText(view)).includes(text)
  }, `Banner ${text}`)
  const nav = async (path, inbox = false) => {
    const url = origin + path
    await call('navigate', inbox ? 'app://inbox' : url)
    await waitFor(async () => {
      const tab = active(await read())
      return tab.url === url && !tab.isLoading && views().some(view => view.getVisible() && view.webContents.getURL() === url)
    }, `visible Smart Paste ${path}`)
    const view = views().find(view => view.getVisible() && view.webContents.getURL() === url)
    view.webContents.setBackgroundThrottling(false)
    return view
  }
  const pointer = (contents, x, y, button) => {
    contents.sendInputEvent({ type: 'mouseMove', x, y })
    for (const type of ['mouseDown', 'mouseUp']) contents.sendInputEvent({ type, x, y, button, clickCount: 1 })
  }
  async function context(view, selector = '#field', frame = view.webContents.mainFrame, iframe) {
    menu = undefined
    window.show(); window.focus(); view.webContents.focus()
    const point = await frame.executeJavaScript(`(() => {
      const field = document.querySelector(${JSON.stringify(selector)}); field.focus();
      if (field.setSelectionRange && field.type !== 'password') field.setSelectionRange(5, 8);
      if (field.isContentEditable) {
        const range = document.createRange(); range.setStart(field.firstChild, 5); range.setEnd(field.firstChild, 8);
        getSelection().removeAllRanges(); getSelection().addRange(range);
      }
      const bounds = field.getBoundingClientRect(); return { x: Math.round(bounds.x + (field.id === 'field' || field.isContentEditable ? 64 : 8)), y: Math.round(bounds.y + 8) };
    })()`)
    const offset = iframe ? await view.webContents.executeJavaScript(`(() => {
      const frame = document.querySelector(${JSON.stringify(iframe)}), bounds = frame.getBoundingClientRect();
      return { x: bounds.x + frame.clientLeft, y: bounds.y + frame.clientTop };
    })()`) : { x: 0, y: 0 }
    if (iframe) {
      const { debugger: debug } = view.webContents
      const coordinates = { x: point.x + offset.x, y: point.y + offset.y, button: 'right', clickCount: 1 }
      const attached = debug.isAttached()
      if (!attached) debug.attach()
      try {
        await debug.sendCommand('Input.dispatchMouseEvent', { ...coordinates, type: 'mouseMoved', button: 'none' })
        await debug.sendCommand('Input.dispatchMouseEvent', { ...coordinates, type: 'mousePressed' })
        await debug.sendCommand('Input.dispatchMouseEvent', { ...coordinates, type: 'mouseReleased' })
      } finally { if (!attached) debug.detach() }
    } else pointer(view.webContents, point.x, point.y, 'right')
    await waitFor(() => Boolean(menu), `native Smart Paste menu for ${selector}`)
    assert.equal(popup.frame.frameToken, frame.frameToken, `menu frame ${popup.frame.url} should be ${frame.url}`)
    return menu.getMenuItemById('smart-paste')?.submenu?.items.find(item => item.id === `smart-paste-${id}`)
  }
  const choose = async (...args) => {
    const item = await context(...args)
    assert(item, 'Smart Paste menu item exists on the selected editable field')
    item.click(item, window, {})
  }
  const value = frame => frame.executeJavaScript('document.querySelector("#field").value')
  const setConfig = (title, prompt) => data('settings', 'savePreferences', { smartPaste: { configs: [{ id, title, prompt }] } })
  const endActive = () => waitFor(async () => !(await evaluate('window.askAgent.listActive({})')).value.length, 'durable Smart Paste terminal state')
  try {
    await call('navigate', 'app://settings')
    await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(settingsSelector)})`), 'Smart Paste Settings')
    const applyDraft = text => evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(settingsField)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await applyDraft('   ')
    await evaluate(`document.querySelector(${JSON.stringify(settingsSelector)}).requestSubmit()`)
    await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(settingsSelector)}).textContent.includes('Enter a valid title')`), 'Smart Paste save validation feedback')
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(settingsField)}).value`), '   ')
    await applyDraft('Saved from UI')
    await evaluate(`document.querySelector(${JSON.stringify(settingsSelector)}).requestSubmit()`)
    await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(settingsSelector)}).textContent.includes('Changes saved.')`), 'Smart Paste Settings saved')
    const ai = { providers: [{ id: model, name: 'Smart Paste fixture', baseURL: origin, requiresKey: false, models: [model],
      defaultModel: model, capabilities: { [model]: { contextWindow: 65536, maxOutputTokens: 8192, source: 'manual', verified: true } } }],
    default: { providerId: model, modelId: model } }
    assert((await data('settings', 'savePreferences', { ai, theme: 'light', mailbox: { provider: 'custom', url: 'https://smart-paste.fixture.invalid/inbox' } })).ok)
    assert((await setConfig('Original title', 'First prompt.')).ok)
    await clipboard.writeText('Example clipboard')
    const page = await nav('/form?token=secret'), mainFrame = page.webContents.mainFrame
    const same = mainFrame.frames.find(frame => frame.url.includes('frame-same'))
    const cross = mainFrame.frames.find(frame => frame.url.includes('frame-cross'))
    assert(same && cross)
    for (const frame of [mainFrame, same, cross]) {
      assert.deepEqual(await frame.executeJavaScript('[typeof require, typeof process, typeof window.browser, typeof window.askAgent]'),
        ['undefined', 'undefined', 'undefined', 'undefined'])
    }
    assert.equal(await context(page, '#password'), undefined)
    assert.equal(await context(page, '#readonly'), undefined)
    assert.equal((await context(page)).label, 'Original title')
    assert((await setConfig('Updated title', 'Use the updated prompt.')).ok)
    assert.equal((await context(page)).label, 'Updated title')

    let tools, final
    respond = (input, response) => {
      if (input.messages.some(message => message.role === 'tool')) { final = () => finish(response, 'Answer'); return }
      response.write(delta({ reasoning_content: 'Internal reasoning' }))
      response.write(delta({ content: 'Temporary' }))
      const activate = input.tools.find(tool => tool.function.description.startsWith('[tool.activate] '))
      assert(activate)
      tools = () => response.end(delta({ tool_calls: [{ index: 0, id: 'tool-preamble', type: 'function', function: {
        name: activate.function.name, arguments: JSON.stringify({ names: ['profile.list'] })
      } }] }, 'tool_calls') + 'data: [DONE]\n\n')
    }
    const current = active(await read()).targetId
    await choose(page, '#field', cross, '#cross')
    await waitFor(async () => await value(cross) === 'left Temporary right', 'original SSE reaches a cross-origin iframe')
      .catch(async error => { error.message += ` (field: ${await value(cross)})`; throw error })
    await waitBanner('Filling Updated title')
    const notice = banner()
    assert.equal(window.contentView.children.at(-1), notice)
    assert.equal(await cross.executeJavaScript('window.observed'), 'left Temporary right')
    assert.equal(await cross.executeJavaScript('document.activeElement.id'), 'field')
    assert.equal(active(await read()).targetId, current)
    assert.equal(await value(mainFrame), 'left OLD right')
    assert.equal(await value(same), 'left OLD right')
    const user = calls[0].messages.find(message => message.role === 'user').content
    assert(user.startsWith('Use the updated prompt.\n\n<smart-paste-context>\n'))
    assert(!user.includes('Updated title') && !user.includes('token=') && user.includes('Example clipboard') && user.includes('frame-cross'))
    tools()
    await waitFor(async () => await value(cross) === 'left OLD right' && Boolean(final), 'tool-round preamble rolled back')
    const [width, height] = window.getContentSize()
    window.setContentSize(width - 16, height - 16)
    await waitFor(() => notice.getBounds().x === width - 16 - 368 - 16, 'Banner follows resize')
    assert.deepEqual(notice.getBounds(), { x: width - 400, y: height - 112, width: 368, height: 80 })
    await data('settings', 'savePreferences', { theme: 'dark' })
    await waitFor(() => notice.webContents.executeJavaScript('document.documentElement.dataset.theme === "dark"'), 'native Banner dark theme')
    await waitBanner('Reading context')
    pointer(notice.webContents, 36, 25, 'left')
    await waitFor(() => evaluate('!!document.querySelector(".ai-composer")'), 'Banner opens Ask AI')
    final()
    await waitFor(async () => await value(cross) === 'left Answer right', 'background field finishes while viewing Ask AI')
    await waitFor(() => evaluate('document.body.innerText.includes("Answer")'), 'linked session is selected')
    await waitBanner('Finished Updated title')
    pointer(notice.webContents, 335, 40, 'left')
    await waitFor(() => !notice.getVisible(), 'Banner close does not navigate')

    await call('navigate', 'app://browser')
    await waitFor(() => page.getVisible(), 'same retained Browser surface')
    respond = (_input, response) => {
      response.write(delta({ content: 'Partial' }))
      final = () => response.end('data: [DONE]\n\n')
    }
    final = undefined
    await choose(page, '#field', same, '#same')
    await waitFor(async () => await value(same) === 'left Partial right', 'same-origin frame partial answer')
    final()
    await waitBanner('Could not finish')
    assert.equal(await value(same), 'left Partial right')
    await endActive()

    const inbox = await nav('/inbox', true), inboxFrame = inbox.webContents.mainFrame
    respond = (_input, response) => {
      response.write(delta({ content: 'Inbox draft' }))
      final = () => finish(response, ' must not overwrite')
    }
    await choose(inbox, '#editable')
    await waitFor(() => inboxFrame.executeJavaScript('document.querySelector("#editable").textContent === "left Inbox draft right" && window.observedEditable'), 'Inbox editable range')
    await inboxFrame.executeJavaScript('document.querySelector("#editable").textContent = "User replacement"')
    await waitBanner('Stopped filling')
    await endActive()
    assert.equal(await inboxFrame.executeJavaScript('document.querySelector("#editable").textContent'), 'User replacement')

    await call('navigate', 'app://browser')
    await waitFor(() => page.getVisible(), 'return to Browser for iframe navigation')
    await same.executeJavaScript('document.querySelector("#field").value = "left OLD right"')
    respond = (_input, response) => { response.write(delta({ content: 'Keep me' })) }
    await choose(page, '#field', same, '#same')
    await waitFor(async () => await value(same) === 'left Keep me right', 'cancel target has a partial answer')
    const { run, items } = (await evaluate('window.askAgent.listActive({})')).value[0]
    assert.equal(items.find(item => item.content.type === 'user_message').content.source, 'smart-paste')
    assert((await evaluate(`window.askAgent.cancel({runId: ${JSON.stringify(run.id)}})`)).ok)
    await endActive()
    await waitBanner('Stopped filling')
    assert.equal(await value(same), 'left Keep me right')

    respond = (_input, response) => { response.write(delta({ content: 'Discarded document' })) }
    await choose(page, '#field', same, '#same')
    await waitFor(async () => (await value(same)).includes('Discarded document'), 'running before frame navigation')
    await mainFrame.executeJavaScript(`document.querySelector('#same').src = ${JSON.stringify(origin + '/frame-replaced')}`)
    await endActive()
    await waitBanner('Stopped filling')
    const replaced = mainFrame.frames.find(frame => frame.url.includes('frame-replaced'))
    assert(replaced)
    assert.equal(await value(replaced), 'left OLD right')

    await choose(page, '#field', replaced, '#same')
    await waitFor(async () => (await value(replaced)).includes('Discarded document'), 'running before frame removal')
    await mainFrame.executeJavaScript('document.querySelector("#same").remove()')
    await endActive()
    await waitBanner('Stopped filling')
    assert.equal(await value(mainFrame), 'left OLD right')
    assert.equal(serverError, undefined)
    console.log('Smart Paste smoke passed: saved settings, isolated Browser/Inbox frames, native menus, SSE and rollback, Banner navigation and interrupted writes.')
  } finally {
    Menu.prototype.popup = menuPopup
    webSession.webRequest.onBeforeRequest(null)
    const notice = banner()
    if (notice?.getVisible()) {
      pointer(notice.webContents, 335, 40, 'left')
      await waitFor(() => !notice.getVisible(), 'Smart Paste smoke cleanup')
    }
    await call('navigate', 'app://ai')
    window.setContentSize(...previousSize)
    await clipboard.writeText(originalClipboard)
    await data('settings', 'savePreferences', { ai: original.ai, mailbox: original.mailbox, theme: original.theme, smartPaste: original.smartPaste ?? { configs: [] } })
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
