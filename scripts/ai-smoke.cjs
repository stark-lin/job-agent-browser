const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

module.exports = async function aiSmoke({ window, call, evaluate, waitFor }) {
  const requests = []
  const chunk = (content, finish = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`
  const server = createServer((request, response) => {
    let text = ''
    request.on('data', data => { text += data })
    request.on('end', () => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'fixture-model' }, { id: 'fixture-other' }] }))
        return
      }
      const body = JSON.parse(text)
      requests.push({ body, path: request.url, auth: request.headers.authorization })
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(chunk('Fixture '))
      if (body.messages.at(-1).content === 'cancel') return
      const timer = setTimeout(() => response.end(chunk('reply 中文', 'stop') + 'data: [DONE]\n\n'), 150)
      response.on('close', () => clearTimeout(timer))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = `http://127.0.0.1:${server.address().port}`
  const data = (group, method, input) => evaluate(`window.data.${group}.${method}(${JSON.stringify(input)})`)
  const original = (await data('settings', 'get', {})).value.ai
  const frame = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const field = async (selector, text, type = 'input') => {
    await evaluate(`(() => {
      const control = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(${type === 'textarea' ? 'HTMLTextAreaElement' : type === 'select' ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype, 'value').set.call(control, ${JSON.stringify(text)});
      control.dispatchEvent(new Event(${JSON.stringify(type === 'select' ? 'change' : 'input')}, { bubbles: true }));
    })()`)
    await frame()
  }
  const button = text => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(text)}).click()`)
  try {
    await call('navigate', 'app://settings')
    await waitFor(() => evaluate('!!document.querySelector("form[data-ai-config]")'), 'AI provider form')
    const timeouts = { requestSeconds: 300, pageSeconds: 60, modelsSeconds: 30 }
    for (const [name, value] of Object.entries(timeouts)) await field(`form[data-ai-config] input[name=${name}]`, String(value))
    await field('form[data-ai-config] input[name=pageSeconds]', '0')
    assert.equal(await evaluate('document.querySelector("form[data-ai-config]").checkValidity()'), false)
    await field('form[data-ai-config] input[name=pageSeconds]', '60')
    await button('Add provider')
    await field('form[data-ai-config] input:not([type])', 'Fixture provider')
    await field('form[data-ai-config] input[type=url]', root)
    // Associated labels select the intended control regardless of form layout.
    await evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find(label => label.textContent === 'Authentication');
      const control = document.getElementById(label.htmlFor);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(control, 'false');
      control.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await evaluate('document.querySelector("form[data-ai-config]").requestSubmit()')
    await waitFor(async () => (await data('settings', 'get', {})).value.ai.providers.some(provider => provider.baseURL === root), 'saved endpoint without models')
    assert.deepEqual((await data('settings', 'get', {})).value.ai.timeouts, timeouts)
    await waitFor(() => evaluate('[...document.querySelectorAll("button")].some(button => button.textContent === "Detect models" && !button.disabled)'), 'model detection enabled')
    await button('Detect models')
    await waitFor(() => evaluate('document.body.innerText.includes("Detected 2 models.")'), 'discovered models through production IPC')
    const detected = await evaluate('(() => { const label = [...document.querySelectorAll("label")].find(label => label.textContent === "Available models"); return "[id=" + JSON.stringify(label.htmlFor) + "]" })()')
    await field(detected, 'fixture-model', 'select')
    assert.equal(await evaluate('document.querySelector("form[data-ai-config] textarea").value'), 'fixture-model')
    assert.equal((await data('settings', 'get', {})).value.ai.providers.find(provider => provider.baseURL === root).models.length, 0)
    await button('Use as global default')
    await evaluate('document.querySelector("form[data-ai-config]").requestSubmit()')
    await waitFor(async () => (await data('settings', 'get', {})).value.ai.default?.modelId === 'fixture-model', 'saved custom provider/default')
    assert.deepEqual((await data('settings', 'get', {})).value.ai.timeouts, timeouts)
    await button('Test connection')
    await waitFor(() => evaluate('document.body.innerText.includes("Connection and streaming response verified.")'), 'real connection test')
    const settingsSize = window.getContentSize(), settingsMinimum = window.getMinimumSize()
    window.setMinimumSize(320, 320)
    try {
      for (const width of [320, 640, 1200]) {
        window.setContentSize(width, 820)
        await waitFor(() => evaluate(`innerWidth === ${width}`), `model settings viewport ${width}`)
        assert.equal(await evaluate('document.querySelector(".settings-page").scrollWidth > document.querySelector(".settings-page").clientWidth'), false)
      }
      await evaluate('document.querySelector("form[data-ai-config]").scrollIntoView()')
      mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
      writeFileSync(resolve(__dirname, '../.cache/ai-settings-models.png'), (await window.capturePage()).toPNG())
    } finally { window.setContentSize(...settingsSize); window.setMinimumSize(...settingsMinimum) }
    await call('navigate', 'app://ai')
    await waitFor(() => evaluate('document.querySelector(".ai-selectors select")?.value.startsWith("provider-")'), 'chat inherits default provider')
    await field('.ai-page textarea', 'PRIVATE_CHAT_PROMPT', 'textarea')
    await evaluate('document.querySelector(".ai-composer").requestSubmit()')
    await waitFor(() => evaluate('document.querySelector(".ai-message") && document.body.innerText.includes("Fixture ")'), 'visible SSE delta')
    await waitFor(() => evaluate('document.body.innerText.includes("reply 中文") && !document.querySelector(".ai-page textarea").disabled'), 'stream completed')
    assert.equal(requests.at(-1).path, '/v1/chat/completions')
    assert.equal(requests.at(-1).auth, undefined)
    assert.equal(requests.at(-1).body.model, 'fixture-model')
    const logs = (await data('audit', 'list', { targetType: 'ai_request' })).value
    assert.equal(logs.total, 2)
    assert(logs.items.every(entry => entry.status === 'SUCCESS' && Object.keys(entry).length === 15))
    assert.equal(JSON.stringify(logs).includes('PRIVATE_CHAT_PROMPT'), false)
    assert.equal(JSON.stringify(logs).includes(root), false)
    mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
    writeFileSync(resolve(__dirname, '../.cache/ai-chat.png'), (await window.capturePage()).toPNG())
    const originalSize = window.getContentSize(), minimum = window.getMinimumSize()
    window.setMinimumSize(320, 320)
    try {
      for (const width of [320, 640, 1200]) {
        window.setContentSize(width, 820)
        await waitFor(() => evaluate(`innerWidth === ${width}`), `AI viewport ${width}`)
        assert.equal(await evaluate('document.querySelector(".ai-page").scrollWidth > document.querySelector(".ai-page").clientWidth'), false)
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".ui-textarea")).minHeight'), '96px')
      }
    } finally { window.setContentSize(...originalSize); window.setMinimumSize(...minimum) }
    await field('.ai-page textarea', 'cancel', 'textarea')
    await evaluate('document.querySelector(".ai-composer").requestSubmit()')
    await waitFor(async () => (await data('audit', 'list', { targetType: 'ai_request' })).value.total === 3, 'cancel request started')
    await button('Stop')
    await waitFor(() => evaluate('document.body.innerText.includes("Stopped. The response may be incomplete.")'), 'cancelled UI')
    assert.equal((await data('audit', 'list', { targetType: 'ai_request' })).value.total, 3)
    await call('navigate', 'app://home'); await call('navigate', 'app://ai')
    await waitFor(() => evaluate('!!document.querySelector(".ai-page textarea")'), 'return to chat')
    assert.equal(await evaluate('document.querySelectorAll(".ai-message").length'), 0)
    console.log('AI smoke passed: configurable timeouts and validation, bare endpoints, model detection/selection, saved defaults, connection test, actual SSE through production IPC, cancellation, audit privacy and responsive settings/chat.')
  } finally {
    await call('navigate', 'app://home')
    await data('settings', 'savePreferences', { ai: original })
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
