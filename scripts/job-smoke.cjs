const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { dialog } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

module.exports = async function jobSmoke({ window, call, read, active, evaluate, waitFor }) {
  const data = (method, input = {}) => evaluate(`window.data.jobs.${method}(${JSON.stringify(input)})`)
  const preferences = input => evaluate(`window.data.settings.savePreferences(${JSON.stringify(input)})`)
  const original = (await evaluate('window.data.settings.get({})')).value
  const originalSize = window.getContentSize(), minimum = window.getMinimumSize(), oldMessage = dialog.showMessageBox
  const frame = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const button = async (text, scope = 'document') => {
    await waitFor(() => evaluate(`!!${scope} && [...${scope}.querySelectorAll('button')].some(button => button.textContent === ${JSON.stringify(text)} && !button.disabled)`), `job button ${text}`)
    await evaluate(`[...${scope}.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(text)} && !button.disabled).click()`); await frame()
  }
  const field = async (name, text) => {
    await evaluate(`(() => { const input = document.querySelector('[name="${name}"]');
      Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', {bubbles:true})); })()`); await frame()
  }
  let aiCalls = 0, malformed = false, slow = false, headers
  const parsed = { title: 'Imported engineer', companyNameRaw: 'Imported company', description: 'Build reliable services.', locationText: 'Sydney', employmentType: 'Full-time',
    locations: [{ text: 'Sydney', city: 'Sydney', state: 'NSW', country: 'Australia', mode: 'HYBRID' }],
    salary: { min: 120000, max: 150000, currency: 'AUD', text: 'AUD 120k–150k', period: 'YEAR' },
    requirements: [{ text: 'TypeScript experience', type: 'REQUIRED', keywords: ['TypeScript'] }] }
  const server = createServer((request, response) => {
    if (request.url === '/restricted') { response.writeHead(403); response.end('Restricted'); return }
    if (request.url === '/job') {
      headers = request.headers; response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<title>Public engineer</title><main><h1>Engineer</h1><p>Build reliable TypeScript services in Sydney with a collaborative team. Salary AUD 120000 to 150000 per year.</p></main>'); return
    }
    request.resume(); request.on('end', () => {
      aiCalls++
      const output = malformed ? '{"id":"forbidden","title":"Bad output"}' : JSON.stringify(parsed)
      const chunk = content => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\n`
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (slow) response.write(': waiting\n\n')
      else response.end(chunk(output) + 'data: [DONE]\n\n')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    await preferences({ ai: { providers: [], default: null }, language: 'en', theme: 'light' })
    await call('navigate', 'app://find')
    await waitFor(() => evaluate('!!document.querySelector("[name=title]")'), 'manual job form')
    await field('title', 'Manual engineer'); await field('companyNameRaw', 'Manual company'); await field('notes', 'Keep these notes')
    // Invalid required fields never dispatch a save.
    await field('companyNameRaw', '')
    await evaluate('document.querySelector(".job-page form").requestSubmit()'); await frame()
    assert.equal((await data('listJobs')).value.items.some(job => job.title === 'Manual engineer'), false)
    await field('companyNameRaw', 'Manual company')
    // A cancelled navigation keeps the in-memory job draft.
    let prompts = 0
    dialog.showMessageBox = async () => { prompts++; return { response: 0, checkboxChecked: false } }
    await call('navigate', 'app://home'); assert.equal(active(await read()).destination.page, 'find'); assert.equal(prompts, 1)
    dialog.showMessageBox = oldMessage
    await button('Save job')
    await waitFor(async () => active(await read()).destination.page === 'applications', 'manual job saved and navigated')
    await waitFor(() => evaluate('!!document.querySelector("dialog[open]") && document.querySelector("dialog[open]").innerText.includes("Manual engineer")'), 'saved job details')
    let job = (await data('listJobs')).value.items.find(job => job.title === 'Manual engineer')
    assert.equal(job.applicationStatus, 'NOT_STARTED'); assert.equal(job.appliedAt, null); assert.equal(job.closedAt, null)
    assert.equal((await data('listSources', { jobId: job.id })).value.total, 0)
    assert.equal((await evaluate(`window.data.applications.listEvents({jobId:${JSON.stringify(job.id)}})`)).value.total, 0)
    await button('Close', 'document.querySelector("dialog[open]")')
    await preferences({ ai: { providers: [{ id: 'job-fixture', name: 'Job fixture', baseURL: `${origin}/v1`, requiresKey: false, models: ['fixture'], defaultModel: 'fixture' }], default: { providerId: 'job-fixture', modelId: 'fixture' } } })
    await call('navigate', 'app://find')
    await waitFor(() => evaluate('document.body.innerText.includes("Job fixture")'), 'job model disclosure')
    await field('title', 'Keep manual title'); await field('notes', 'Keep manual notes'); await field('jobUrl', `${origin}/restricted`)
    await button('Parse with AI'); await waitFor(() => evaluate('document.body.innerText.includes("restricts access")'), 'access restriction error')
    assert.equal(aiCalls, 0)
    await field('jobUrl', `${origin}/job`); malformed = true
    await button('Parse with AI'); await waitFor(() => evaluate('document.body.innerText.includes("does not match the job fields")'), 'invalid AI output error')
    assert.equal(await evaluate('document.querySelector("[name=title]").value'), 'Keep manual title')
    malformed = false; slow = true
    await button('Parse with AI'); await waitFor(() => Promise.resolve(aiCalls === 2), 'in-flight parsing')
    await button('Cancel parsing'); slow = false
    await button('Parse with AI'); await waitFor(() => evaluate('document.querySelector("[name=companyNameRaw]").value === "Imported company"'), 'AI fills draft')
    assert.equal(await evaluate('document.querySelector("[name=title]").value'), 'Keep manual title')
    assert.equal(await evaluate('document.querySelector("[name=notes]").value'), 'Keep manual notes')
    assert.equal(headers.cookie, undefined)
    await button('Save job')
    await waitFor(async () => active(await read()).destination.page === 'applications', 'import saved and navigated')
    await waitFor(() => evaluate('!!document.querySelector("dialog[open]") && document.querySelector("dialog[open]").innerText.includes("Imported company")'), 'import details')
    job = (await data('listJobs')).value.items.find(job => job.title === 'Keep manual title')
    assert.equal(job.applicationStatus, 'NOT_STARTED'); assert.equal(job.requirements.length, 1); assert.equal(job.locations[0].mode, 'HYBRID'); assert.equal(job.salary.min, 120000)
    const source = (await data('listSources', { jobId: job.id })).value.items[0]
    assert.equal(source.url, `${origin}/job`); assert.equal(source.pageTitle, 'Public engineer'); assert(source.cleanedContent.includes('TypeScript'))
    assert.equal(await evaluate('document.querySelector("dialog[open] a").target'), '_blank')
    await button('Close', 'document.querySelector("dialog[open]")')
    await field('jobSearch', 'Manual company'); await button('Apply filters')
    await waitFor(() => evaluate('document.querySelector("tbody")?.innerText.includes("Manual engineer")'), 'job search')
    assert.equal(await evaluate('document.querySelector("tbody").innerText.includes("Imported company")'), false)
    await field('jobSearch', ''); await button('Apply filters')
    for (let index = 0; index < 25; index++) await data('saveJob', { details: { title: `Pagination role ${index}`, companyNameRaw: 'Pages company' } })
    await button('Refresh'); await waitFor(() => evaluate('document.querySelectorAll("tbody tr").length === 25'), 'job list page one')
    await button('Next'); await waitFor(() => evaluate('document.querySelectorAll("tbody tr").length < 25'), 'job list page two')
    await button('Previous')
    const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve)); window.webContents.reload(); await loaded
    await waitFor(() => evaluate('document.querySelectorAll("tbody tr").length === 25'), 'persisted job list after renderer reload')
    window.setMinimumSize(320, 320); mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
    for (const language of ['en', 'zh-CN']) for (const theme of ['light', 'dark']) {
      await preferences({ language, theme }); await frame()
      for (const page of ['find', 'applications']) {
        await call('navigate', `app://${page}`)
        await waitFor(() => evaluate('!!document.querySelector(".job-page")'), 'job page layout')
        for (const width of [320, 640, 1200]) {
          window.setContentSize(width, 820); await frame()
          assert.equal(await evaluate('document.querySelector(".job-page").scrollWidth > document.querySelector(".job-page").clientWidth'), false, `job overflow ${page}/${language}/${theme}/${width}`)
          if (language === 'zh-CN' && width === 1200) writeFileSync(resolve(__dirname, `../.cache/job-${page}-${theme}.png`), (await window.capturePage()).toPNG())
        }
      }
    }
    console.log('Job smoke passed: manual/URL import, real HTML/SSE, restrictions, invalid output, cancel/retry, protected manual fields, NOT_STARTED save/source/details, list search/pagination/reload and bilingual theme/layout.')
  } finally {
    dialog.showMessageBox = oldMessage
    window.setMinimumSize(...minimum); window.setContentSize(...originalSize)
    await preferences({ ai: original.ai, language: original.language, theme: original.theme })
    await call('navigate', 'app://home')
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  }
}
