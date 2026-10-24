const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { dialog } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { pdfFixture } = require('./profile-fixtures.cjs')

module.exports = async function parallelImportSmoke({ window, call, evaluate, waitFor }) {
  const original = (await evaluate('window.data.settings.get({})')).value
  const previousOpen = dialog.showOpenDialog, previousMessage = dialog.showMessageBox
  const size = window.getContentSize(), minimum = window.getMinimumSize()
  const frame = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const preferences = input => evaluate(`window.data.settings.savePreferences(${JSON.stringify(input)})`)
  const button = async text => {
    await waitFor(() => evaluate(`[...document.querySelectorAll('button')].some(button => button.textContent === ${JSON.stringify(text)} && !button.disabled)`), `parallel button ${text}`)
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(text)} && !button.disabled).click()`); await frame()
  }
  const field = async (selector, value, select = false) => {
    await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('${select ? 'change' : 'input'}', {bubbles:true})); })()`); await frame()
  }
  const counts = {}, failures = new Set(['description', 'experience'])
  let reads = 0, hanging = false
  const outputs = {
    basics: { title: 'Parallel engineer', companyNameRaw: 'Parallel company', salary: null },
    description: { description: 'Build reliable services.' }, requirements: { requirements: [{ text: 'SQL', type: 'REQUIRED', keywords: ['SQL'] }] },
    contact: { contact: { name: 'Parallel candidate' }, links: [], facts: [{ kind: 'LANGUAGE', content: 'English' }] },
    experience: { items: [{ type: 'EXPERIENCE', title: 'Engineer', facts: [{ kind: 'ACHIEVEMENT', content: 'Built services' }] }] },
    projects: { items: [] }, education: { items: [] }
  }
  const server = createServer((request, response) => {
    if (request.url === '/job') {
      reads++; response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<title>Parallel job</title><main>Engineer at Parallel company. Build reliable services and work with SQL in an experienced engineering team.</main>'); return
    }
    let body = ''; request.on('data', chunk => { body += chunk }); request.on('end', () => {
      const input = JSON.parse(body), prompt = input.messages[0].content, group = /This is the (\w+) extraction group/.exec(prompt)?.[1]
      assert(outputs[group], `unexpected group ${group}`); counts[group] = (counts[group] ?? 0) + 1
      if (hanging) { response.writeHead(200, { 'Content-Type': input.stream ? 'text/event-stream' : 'application/json' }); response.write(input.stream ? ': waiting\n\n' : '{\"choices\":'); return }
      const reply = () => {
        if (response.destroyed) return
        if (failures.delete(group)) { response.writeHead(429); response.end('retry part'); return }
        if (!input.stream) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(outputs[group]) } }] })); return }
        const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(outputs[group]) }, finish_reason: 'stop' }] })}\n\n`
        response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end(chunk + 'data: [DONE]\n\n')
      }
      if (['contact', 'experience', 'projects', 'education'].includes(group)) setTimeout(reply, 800)
      else reply()
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const pdf = resolve(process.env.JOB_BROWSER_SMOKE_DATA, 'parallel-import.pdf')
  writeFileSync(pdf, pdfFixture({ text: 'Parallel candidate Built services English' }))
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pdf] })
  dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  const capture = async name => {
    mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
    writeFileSync(resolve(__dirname, '../.cache', name), (await window.capturePage()).toPNG())
  }
  const layout = async page => {
    window.setMinimumSize(320, 320)
    for (const language of ['en', 'zh-CN']) for (const theme of ['light', 'dark']) {
      await preferences({ language, theme }); await frame()
      for (const width of [320, 640, 1200]) {
        window.setContentSize(width, 820); await frame()
        assert.equal(await evaluate(`document.querySelector('.${page}-page').scrollWidth > document.querySelector('.${page}-page').clientWidth`), false, `parallel layout ${page}/${language}/${theme}/${width}`)
        if (width === 1200 && language === 'zh-CN') await capture(`parallel-${page}-${theme}.png`)
      }
    }
    await preferences({ language: 'en', theme: 'light' }); window.setContentSize(...size); await frame()
  }
  try {
    await preferences({ language: 'en', theme: 'light', ai: { providers: [{ id: 'parallel-fixture', name: 'Parallel fixture', baseURL: `${origin}/v1`, requiresKey: false, models: ['fixture'], defaultModel: 'fixture' }], default: { providerId: 'parallel-fixture', modelId: 'fixture' } } })
    await call('navigate', 'app://find')
    await waitFor(() => evaluate('document.body.innerText.includes("Parallel fixture")'), 'parallel prerequisite loaded')
    assert.equal(await evaluate('document.querySelector("option[value=parallel]").disabled'), true)
    await call('navigate', 'app://settings')
    await waitFor(() => evaluate('!!document.querySelector("[data-ai-config] input[type=checkbox]")'), 'model parallel opt-in')
    await evaluate('document.querySelector("[data-ai-config] input[type=checkbox]").click()'); await frame()
    await evaluate('document.querySelector("[data-ai-config]").requestSubmit()')
    await waitFor(async () => (await evaluate('window.data.settings.get({})')).value.ai.providers[0].parallelModels?.includes('fixture'), 'parallel setting persisted through real form')
    await call('navigate', 'app://find')
    await waitFor(() => evaluate('!!document.querySelector("option[value=parallel]") && !document.querySelector("option[value=parallel]").disabled'), 'parallel mode enabled')
    await field('.job-page select[name=importMode]', 'parallel', true)
    await field('[name=jobUrl]', `${origin}/job`); await button('Parse with AI')
    await button('Retry failed parts'); assert.equal(reads, 1)
    await waitFor(() => evaluate('document.querySelector("[name=title]").value === "Parallel engineer"'), 'merged parallel job draft')
    assert.deepEqual([counts.basics, counts.description, counts.requirements], [1, 2, 1]); assert.equal(reads, 1)
    await layout('job')
    hanging = true; await button('Parse with AI')
    await waitFor(() => Promise.resolve(counts.basics === 2 && counts.requirements === 2 && counts.description === 3), 'three running requests')
    const runningSeconds = () => evaluate(`Number(/processing ([\\d.]+)s/.exec([...document.querySelectorAll('.ui-details-list dd')].find(node => node.textContent.startsWith('Processing'))?.textContent ?? '')?.[1] ?? 0)`)
    await waitFor(async () => (await runningSeconds()) >= 0.1, 'job processing timer advances before model output')
    const firstSeconds = await runningSeconds()
    await waitFor(async () => (await runningSeconds()) > firstSeconds, 'job processing timer keeps ticking')
    await button('Cancel parsing'); hanging = false
    await call('navigate', 'app://profile')
    await waitFor(() => evaluate('!!document.querySelector(".profile-page option[value=parallel]") && !document.querySelector(".profile-page option[value=parallel]").disabled'), 'profile parallel mode')
    await field('.profile-page select', 'parallel', true)
    await button('Upload PDF and parse')
    await waitFor(() => evaluate(`(() => {
      const group = [...document.querySelectorAll('.ui-details-list > div')].find(node => node.querySelector('dt')?.textContent === 'Education')
      return Number(/queued ([\\d.]+)s/.exec(group?.textContent ?? '')?.[1] ?? 0) >= 0.2
    })()`), 'fourth PDF group queue timer advances while waiting for a batch slot')
    await button('Retry failed parts')
    await waitFor(() => evaluate('[...document.querySelectorAll("textarea")].some(input => input.value === "Built services")'), 'merged compact profile draft')
    assert.deepEqual([counts.contact, counts.experience, counts.projects, counts.education], [1, 2, 1, 1])
    assert.equal(await evaluate('[...document.querySelectorAll(".ui-field-label")].some(label => label.textContent === "Source excerpt and page")'), false, 'import review has no source evidence editor')
    const completedTimings = await evaluate('[...document.querySelectorAll(".ui-details-list dd")].map(node => node.textContent)')
    await evaluate('new Promise(resolve => setTimeout(resolve, 250))')
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".ui-details-list dd")].map(node => node.textContent)'), completedTimings, 'completed timers stay frozen')
    await layout('profile')
    await button('Discard import')
    await waitFor(() => evaluate('!!document.querySelector("dialog[open]")'), 'discard dialog')
    await evaluate('[...document.querySelector("dialog[open]").querySelectorAll("button")].find(button => button.textContent === "Discard import").click()')
    await waitFor(() => evaluate('!document.querySelector("[data-import-id]")'), 'import discarded')
    console.log('Parallel import smoke passed: real model opt-in, independent modes, job/PDF groups, part retry, single page read, compact facts, ticking running/queued timers, frozen completed timers, cancellation and bilingual light/dark layouts at 320/640/1200px.')
  } finally {
    await call('navigate', 'app://home')
    dialog.showOpenDialog = previousOpen; dialog.showMessageBox = previousMessage
    window.setMinimumSize(...minimum); window.setContentSize(...size)
    await preferences({ ai: original.ai, language: original.language, theme: original.theme })
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  }
}
