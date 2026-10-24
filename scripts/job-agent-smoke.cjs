const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { dialog } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
const { pdfFixture } = require('./profile-fixtures.cjs')

module.exports = async function jobAgentSmoke({ window, call, evaluate, waitFor }) {
  const previous = (await evaluate('window.data.settings.get({})')).value
  const oldOpen = dialog.showOpenDialog, oldMessage = dialog.showMessageBox
  const size = window.getContentSize(), minimum = window.getMinimumSize()
  const frame = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const field = async (name, value) => {
    await evaluate(`(() => { const element = document.querySelector('[name="${name}"]');
      const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true})); })()`)
    await frame()
  }
  const button = async text => {
    await waitFor(() => evaluate(`[...document.querySelectorAll('button')].some(button => button.textContent === ${JSON.stringify(text)} && !button.disabled)`), `Agent button ${text}`)
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(text)} && !button.disabled).click()`)
    await frame()
  }
  const jobs = () => evaluate('window.data.jobs.listJobs({limit:100})').then(result => { assert(result.ok); return result.value })
  const eventList = id => evaluate(`window.data.applications.listEvents({jobId:${JSON.stringify(id)},limit:100})`).then(result => { assert(result.ok); return result.value.items })
  let modelCalls = 0
  const server = createServer((request, response) => {
    let body = ''; request.on('data', part => { body += part }); request.on('end', () => {
      modelCalls++
      const input = JSON.parse(body), prompt = input.messages[0].content
      assert.equal(input.stream, false)
      let output
      if (prompt.startsWith('Manage ONLY')) {
        const request = JSON.parse(prompt.split('REQUEST (JSON): ')[1].split('\nSAVED CONTEXT (JSON): ')[0])
        const saved = JSON.parse(prompt.split('SAVED CONTEXT (JSON): ')[1])
        let actions = [], question = ''
        if (request.instruction === 'Mark applied and add note') actions = [{ type: 'set_status', status: 'APPLIED' }, { type: 'add_note', text: 'Recruiter contacted me' }]
        else if (request.instruction === 'Schedule interview') {
          if (!request.answers.length) question = 'Which date and time is the interview?'
          else actions = [{ type: 'schedule_event', eventType: 'INTERVIEW', title: 'Technical interview', description: '', startsAt: '2026-10-27T03:00:00.000Z', endsAt: null }]
        } else if (request.instruction === 'Move interview') actions = [{ type: 'reschedule_event', eventId: saved.events.find(event => event.type === 'INTERVIEW').id, startsAt: '2026-10-28T03:00:00.000Z', endsAt: null }]
        else if (request.instruction === 'Edit job notes') actions = [{ type: 'update_job', changes: { notes: 'Reviewed by the Agent' } }]
        else if (request.instruction === 'Archive job') actions = [{ type: 'set_archived', archived: true }]
        else if (request.instruction === 'Restore job') actions = [{ type: 'set_archived', archived: false }]
        else if (request.instruction === 'Add archived note') actions = [{ type: 'add_note', text: 'Archived note retained' }]
        else if (request.instruction === 'Change archived status') actions = [{ type: 'set_status', status: 'INTERVIEW' }]
        else throw new Error('Unexpected fixture instruction')
        output = { question, actions }
      } else {
        const isPdf = prompt.includes('PDF source engineer')
        output = { title: isPdf ? 'PDF source engineer' : 'Text source engineer', companyNameRaw: 'Agent capture company', description: 'Build reliable services.' }
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }] }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const pdf = resolve(process.env.JOB_BROWSER_SMOKE_DATA, 'capture-job.pdf')
  writeFileSync(pdf, pdfFixture({ text: 'PDF source engineer at Agent capture company. Build reliable services.' }))
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pdf] })
  dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  const preferences = input => evaluate(`window.data.settings.savePreferences(${JSON.stringify(input)})`)
  const requestAction = async (instruction, expected = 'Request completed.') => {
    await field('applicationInstruction', instruction); await button('Run request')
    await waitFor(() => evaluate(`document.querySelector('dialog[open]').innerText.includes(${JSON.stringify(expected)}) && !document.querySelector('[name=applicationInstruction]').disabled`), instruction)
  }
  try {
    await preferences({ language: 'en', theme: 'light', ai: { providers: [{ id: 'agent-fixture', name: 'Agent fixture', baseURL: `http://127.0.0.1:${server.address().port}/v1`, requiresKey: false, models: ['fixture'], defaultModel: 'fixture' }], default: { providerId: 'agent-fixture', modelId: 'fixture' } } })
    const baseline = (await jobs()).total
    await call('navigate', 'app://find')
    await waitFor(() => evaluate('!!document.querySelector("[name=captureSource]")'), 'capture source selector')
    await field('captureSource', 'text'); await field('jobText', 'Text source engineer at Agent capture company. Build reliable services.')
    await button('Parse with AI')
    await waitFor(() => evaluate('document.querySelector("[name=title]").value === "Text source engineer"'), 'text draft ready')
    assert.equal((await jobs()).total, baseline)
    await field('title', 'Reviewed text source engineer'); await button('Save job')
    await waitFor(() => evaluate('!!document.querySelector("[name=applicationInstruction]")'), 'application Agent in saved details')
    const textJob = (await jobs()).items.find(job => job.title === 'Reviewed text source engineer')
    assert(textJob)
    assert.equal((await evaluate(`window.data.jobs.listSources({jobId:${JSON.stringify(textJob.id)}})`)).value.total, 0)
    await requestAction('Mark applied and add note')
    await waitFor(async () => (await eventList(textJob.id)).length === 2, 'status and note persisted')
    await waitFor(() => evaluate('document.querySelector("dialog[open]").innerText.includes("Recruiter contacted me")'), 'timeline refresh')
    await requestAction('Schedule interview', 'Which date and time is the interview?')
    assert.equal((await eventList(textJob.id)).length, 2)
    await field('applicationInstruction', '27 October 2026 at 14:00 Australia/Sydney'); await button('Run request')
    await waitFor(async () => (await eventList(textJob.id)).some(event => event.startsAt === '2026-10-27T03:00:00.000Z'), 'clarified interview persisted')
    await waitFor(() => evaluate('!document.querySelector("[name=applicationInstruction]").disabled'), 'clarified task finished')
    await requestAction('Move interview'); await requestAction('Edit job notes'); await requestAction('Archive job')
    await requestAction('Add archived note'); await requestAction('Change archived status', 'Some or all changes could not be completed.')
    assert.equal((await eventList(textJob.id)).filter(event => event.type === 'NOTE').length, 2)
    await button('Close')
    await evaluate('document.querySelector("[name=archivedJobs]").click()'); await button('Apply filters')
    await waitFor(() => evaluate('document.querySelector("tbody")?.innerText.includes("Reviewed text source engineer")'), 'archived Job filter')
    await button('View details')
    await waitFor(() => evaluate('!!document.querySelector("[name=applicationInstruction]")'), 'archived details')
    await requestAction('Restore job')
    await button('Close')
    await call('navigate', 'app://find')
    await waitFor(() => evaluate('!!document.querySelector("[name=captureSource]")'), 'PDF capture source')
    await field('captureSource', 'pdf'); await button('Choose PDF'); await button('Parse with AI')
    await waitFor(() => evaluate('document.querySelector("[name=title]").value === "PDF source engineer"'), 'PDF draft ready')
    assert.equal((await jobs()).total, baseline + 1)
    await button('Save job')
    await waitFor(async () => (await jobs()).total === baseline + 2, 'PDF saved')
    await waitFor(() => evaluate('!!document.querySelector("[name=applicationInstruction]")'), 'PDF Job details')
    window.setMinimumSize(320, 320)
    mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
    for (const language of ['en', 'zh-CN']) for (const theme of ['light', 'dark']) {
      await preferences({ language, theme }); await frame()
      for (const width of [320, 640, 1200]) {
        window.setContentSize(width, 820); await frame()
        assert.equal(await evaluate('document.querySelector("dialog[open]").scrollWidth > document.querySelector("dialog[open]").clientWidth'), false, `application Agent overflow ${language}/${theme}/${width}`)
        if (language === 'en' && width === 1200) writeFileSync(resolve(__dirname, `../.cache/application-agent-${theme}.png`), (await window.capturePage()).toPNG())
      }
    }
    assert(modelCalls >= 10)
    console.log('Job Agent UI smoke passed: reviewed text/PDF capture via real MCP; application status/note/schedule/reschedule/detail/archive/restore, clarification, archived restrictions, event refresh and bilingual responsive themes.')
  } finally {
    dialog.showOpenDialog = oldOpen; dialog.showMessageBox = oldMessage
    window.setMinimumSize(...minimum); window.setContentSize(...size)
    await preferences({ ai: previous.ai, language: previous.language, theme: previous.theme })
    await call('navigate', 'app://home')
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  }
}
