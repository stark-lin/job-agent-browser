const openSectionCards = require('./open-section-cards.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

module.exports = async function aiSmoke({ window, call, evaluate, waitFor }) {
  const requests = []
  let capabilityRequests = 0
  const chunk = (content, finish = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`
  const server = createServer((request, response) => {
    if (request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/v1/models') {
        response.end(JSON.stringify({ data: [{ id: 'fixture-model' }, { id: 'fixture-other' }] }))
      } else if (request.url === '/api/v1/models') {
        capabilityRequests++
        response.end(JSON.stringify({ models: [{ key: 'fixture-model', loaded_instances: [
          { id: 'fixture-model', config: { context_length: 65536 } }
        ] }] }))
      } else response.writeHead(404).end(JSON.stringify({ error: 'Not found' }))
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    let text = ''
    request.on('data', data => { text += data })
    request.on('end', () => {
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
    const form = '[data-ai-connection]'
    const submit = () => evaluate(`document.querySelector('${form}').requestSubmit()`)
    const byLabel = async (label, value, type) => {
      const selector = await evaluate(`'#' + CSS.escape([...document.querySelectorAll('${form} label')].find(el => el.textContent === ${JSON.stringify(label)}).htmlFor)`)
      await field(selector, value, type)
    }
    await waitFor(() => evaluate(`!!document.querySelector('${form}')`), 'AI connection form')
    await openSectionCards(evaluate, form)
    await button('New connection')
    await field(`${form} input[type=url]`, root)
    await evaluate('document.querySelector("[data-ai-advanced] > summary").click()')
    await byLabel('Connection Name', 'Fixture provider')
    await byLabel('Page Fetch Timeout', '0')
    await submit()
    await waitFor(() => evaluate('document.body.innerText.includes("Enter whole tokens")'), 'invalid timeout feedback')
    await byLabel('Page Fetch Timeout', '60')
    await byLabel('AI Request Timeout', '300')
    await byLabel('Model Discovery Timeout', '30')
    const timeouts = { requestSeconds: 300, pageSeconds: 60, modelsSeconds: 30 }
    await submit()
    await waitFor(() => evaluate('document.body.innerText.includes("Choose a model to continue.")'), 'discovered models through production IPC')
    assert.deepEqual((await data('settings', 'get', {})).value.ai, original, 'selection precedes persistence')
    await byLabel('Model', 'fixture-model', 'select')
    await submit()
    await waitFor(async () => (await data('settings', 'get', {})).value.ai.default?.modelId === 'fixture-model', 'saved custom provider/default')
    assert.deepEqual((await data('settings', 'get', {})).value.ai.timeoutOverrides, timeouts)
    assert.equal(requests.length, 0, 'model discovery makes no completion request')
    const settingsSize = window.getContentSize(), settingsMinimum = window.getMinimumSize()
    window.setMinimumSize(320, 320)
    try {
      for (const width of [320, 640, 1200]) {
        window.setContentSize(width, 820)
        await waitFor(() => evaluate(`innerWidth === ${width}`), `model settings viewport ${width}`)
        assert.equal(await evaluate('document.querySelector(".settings-page").scrollWidth > document.querySelector(".settings-page").clientWidth'), false)
      }
      await evaluate('document.querySelector("[data-ai-connection]").scrollIntoView()')
      mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
      writeFileSync(resolve(__dirname, '../.cache/ai-settings-models.png'), (await window.capturePage()).toPNG())
    } finally { window.setContentSize(...settingsSize); window.setMinimumSize(...settingsMinimum) }
    await call('navigate', 'app://ai')
    await waitFor(() => evaluate('document.querySelector(".ai-composer select")?.value.includes("provider-")'), 'chat inherits default provider')
    await field('.ai-page textarea', 'PRIVATE_CHAT_PROMPT', 'textarea')
    await evaluate('document.querySelector(".ai-composer").requestSubmit()')
    await waitFor(() => evaluate('document.querySelector("[data-item-type=assistant_message]") && document.body.innerText.includes("Fixture ")'), 'visible SSE delta')
    await waitFor(() => evaluate('document.body.innerText.includes("reply 中文") && !document.querySelector(".ai-page textarea").disabled'), 'stream completed')
    assert.equal(capabilityRequests, 1, 'Ask resolves the fixture model context before streaming')
    assert.equal(requests.at(-1).path, '/v1/chat/completions')
    assert.equal(requests.at(-1).auth, undefined)
    assert.equal(requests.at(-1).body.model, 'fixture-model')
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
    await waitFor(async () => (await evaluate('window.askAgent.listActive({})')).value.some(s => s.items.some(i => i.content.type === 'assistant_message' && i.content.text.includes('Fixture '))), 'cancel request started')
    await evaluate('document.querySelector("button[aria-label=Stop]").click()')
    await waitFor(() => evaluate('document.body.innerText.includes("Stopped. The response may be incomplete.")'), 'cancelled UI')
    await call('navigate', 'app://browser'); await call('navigate', 'app://ai')
    await waitFor(() => evaluate('!!document.querySelector(".ai-page textarea")'), 'return to chat')
    assert((await evaluate('document.querySelectorAll("[data-item-type]").length')) > 0)
    console.log('AI smoke passed: configurable timeouts and validation, bare endpoints, model detection/selection, saved defaults, actual SSE through production IPC, cancellation and responsive settings/chat.')
  } finally {
    await call('navigate', 'app://browser')
    await data('settings', 'savePreferences', { ai: original })
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
