const { app, BrowserWindow } = require('electron')
const { chatDebugSmoke, chatDebugLayoutSmoke } = require('./chat-debug-smoke.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { randomUUID } = require('node:crypto')
const { resolve } = require('node:path')
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const directory = process.env.JOB_BROWSER_SMOKE_DATA, stage = process.env.ASK_SMOKE_STAGE
assert(directory)
app.setPath('userData', directory)
const watchdog = setTimeout(() => { console.error(`Ask AI ${stage} timed out`); app.exit(1) }, 55000)
let selected = false
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', e => { if (e.level === 'error') console.error('Renderer:', e.message) })
  if (selected) return
  selected = true; window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    let server
    const evaluate = code => window.webContents.executeJavaScript(code)
    const data = (group, method, input) => evaluate(`window.data.${group}.${method}(${JSON.stringify(input)})`)
    const api = (method, input) => evaluate(`window.askAgent.${method}(${JSON.stringify(input)})`)
    const waitFor = async (condition, label) => { const end = Date.now() + 8000; while (!await condition()) { if (Date.now() > end) throw new Error(`Timed out: ${label}`); await new Promise(r => setTimeout(r, 20)) } }
    const frame = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    const field = async text => { await evaluate(`(() => { const c=document.querySelector('.ai-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(c,${JSON.stringify(text)}); c.dispatchEvent(new Event('input',{bubbles:true})); })()`); await frame() }
    const send = async text => { await field(text); await evaluate("document.querySelector('.ai-composer').requestSubmit()") }
    const click = text => evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`)
    const select = async title => { await evaluate(`[...document.querySelectorAll('.ui-session-select')].find(b=>b.textContent.includes(${JSON.stringify(title)})).click()`); await frame() }
    const metadataPath = resolve(directory, 'ask-smoke.json')
    try {
      await require('./complete-onboarding.cjs')(window)
      if (stage === 'recover') {
        const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
        const snapshot = (await api('getRun', { runId: metadata.crashRun })).value
        assert.equal(snapshot.run.state, 'interrupted')
        assert(snapshot.items.some(i => i.state === 'interrupted' && i.content.text.includes('Checkpoint')))
        await evaluate("window.browser.navigate('app://ai')")
        await waitFor(() => evaluate('!!document.querySelector(".ui-session-select")'), 'recovered chat list')
        await select('crash checkpoint')
        await waitFor(() => evaluate('document.body.innerText.includes("Generation interrupted")'), 'interrupted run UI')
        console.log('Ask AI recovery smoke passed: abrupt process exit retains checkpoint and recovers only abandoned running work.')
      } else {
        const metadata = stage === 'restart' ? JSON.parse(readFileSync(metadataPath, 'utf8')) : {}
        let jobId = metadata.jobId, releases = {}, failCount = 0
        const sse = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`
        const toolResult = content => { try { return JSON.parse(content.split('\nRunGuard guidance:')[0]) } catch { return { notExecuted: true } } }
        const finish = (response, text) => response.end(sse({ content: text }, 'stop') + 'data: [DONE]\n\n')
        server = createServer((request, response) => {
          if (request.method === 'GET') { response.writeHead(404).end(); return }
          let raw = ''; request.on('data', c => { raw += c }); request.on('end', async () => {
            const body = JSON.parse(raw)
            assert.equal(body.stream, true, 'Ordinary Ask smoke must not run automatic model tasks')
            const user = body.messages.findLast(m => m.role === 'user').content, lastUser = body.messages.findLastIndex(m => m.role === 'user')
            for (const previous of body.messages.filter(m => m.role === 'assistant' && m.tool_calls?.length)) {
              assert.equal(previous.reasoning_content, 'Full provider reasoning 中文')
              assert.equal(previous.reasoning_details.find(d => d.type === 'reasoning.encrypted').data, 'OPAQUE_PROVIDER_STATE')
            }
            const observations = body.messages.slice(lastUser).filter(m => m.role === 'tool' && !toolResult(m.content).activeOnNextRequest).length
            assert(!body.tools.some(t => /^\[(resume\.|artifact\.build)/.test(t.function.description)), 'Ask never advertises generation tools')
            response.writeHead(200, { 'Content-Type': 'text/event-stream' })
            response.write(sse({ reasoning_content: 'Full provider reasoning 中文', reasoning: 'Full provider reasoning 中文' }))
            response.write(sse({ reasoning_summary: 'Comparing saved job information 中文', reasoning_details: [
              { type: 'reasoning.summary', index: 0, summary: 'Comparing saved job information 中文' },
              { type: 'reasoning.encrypted', index: 1, data: 'OPAQUE_PROVIDER_STATE', signature: 'PRIVATE_SIGNATURE' }
            ] }))
            await new Promise(r => setTimeout(r, 150))
            if (user === 'hold reasoning') { response.write(sse({ reasoning_content: ' still thinking' })); releases[user] = () => finish(response, 'Reasoning finished'); return }
            if (user.startsWith('hold')) { response.write(sse({ content: `Working ${user}` })); releases[user] = () => finish(response, ' completed'); return }
            if (user === 'crash checkpoint') { response.write(sse({ content: 'Checkpoint survives process termination.' })); return }
            if (user === 'failure' && failCount++ === 0) { response.end(sse({ content: 'Partial response' }) + 'data: [DONE]\n\n'); return }
            if (user === 'archive loop') {
              const archive = body.tools.find(t => t.function.description.startsWith('[job.set_archived] '))
              const activate = body.tools.find(t => t.function.description.startsWith('[tool.activate] '))
              const calls = archive ? [true, false, true, false].map((archived, i) => ({ index: i, id: `archive-loop-${i}`, type: 'function', function: { name: archive.function.name, arguments: JSON.stringify({ id: jobId, archived }) } }))
                : [{ index: 0, id: 'activate-archive', type: 'function', function: { name: activate.function.name, arguments: JSON.stringify({ names: ['job.set_archived'] }) } }]
              assert(!body.messages.slice(lastUser).some(m => m.role === 'tool' && toolResult(m.content).error === 'TOOL_GUARD_TERMINATED'), 'No model request after guard termination')
              response.end(sse({ tool_calls: calls }, 'tool_calls') + 'data: [DONE]\n\n'); return
            }
            if (user === 'read recovery') {
              if (body.messages.some(m => m.role === 'system' && m.content.includes('Runtime RunGuard recovery:'))) { finish(response, 'Answered from confirmed information after recovery.'); return }
              const read = body.tools.find(t => t.function.description.startsWith('[job.list] '))
              const note = body.tools.find(t => t.function.description.startsWith('[application.add_note] '))
              const activate = body.tools.find(t => t.function.description.startsWith('[tool.activate] '))
              const calls = read && note ? [...Array.from({ length: 4 }, (_, i) => ({ index: i, id: `read-${i}`, type: 'function', function: { name: read.function.name, arguments: '{}' } })),
                { index: 4, id: 'skip-note', type: 'function', function: { name: note.function.name, arguments: JSON.stringify({ jobId, requestId: randomUUID(), text: 'Must never execute' }) } }]
                : [{ index: 0, id: 'activate-read', type: 'function', function: { name: activate.function.name, arguments: JSON.stringify({ names: ['job.list', 'application.add_note'] }) } }]
              response.end(sse({ tool_calls: calls }, 'tool_calls') + 'data: [DONE]\n\n'); return
            }
            if (user !== 'workflow') { finish(response, 'Recovered answer'); return }
            const wanted = ['job.list', 'profile.list', 'application.get', 'application.add_note', 'application.set_status']
            if (!wanted.every(name => body.tools.some(t => t.function.description.startsWith(`[${name}] `)))) {
              const activate = body.tools.find(t => t.function.description.startsWith('[tool.activate] '))
              assert(activate)
              response.end(sse({ tool_calls: [{ index: 0, id: 'discover-workflow', type: 'function', function: { name: activate.function.name, arguments: JSON.stringify({ names: ['job.list', 'profile.list', 'application.get', 'application.add_note', 'application.set_status'] }) } }] }, 'tool_calls') + 'data: [DONE]\n\n'); return
            }
            const tool = name => { const entry = body.tools.find(t => t.function.description.startsWith(`[${name}] `)); assert(entry); return entry.function.name }
            const calls = observations === 0 ? [
              { id: 'jobs', type: 'function', function: { name: tool('job.list'), arguments: '{}' } },
              { id: 'profiles', type: 'function', function: { name: tool('profile.list'), arguments: '{}' } },
              { id: 'state', type: 'function', function: { name: tool('application.get'), arguments: JSON.stringify({ jobId }) } }
            ] : observations === 3 ? [
              { id: 'note', type: 'function', function: { name: tool('application.add_note'), arguments: JSON.stringify({ jobId, text: 'PRIVATE_NOTE_RESULT', requestId: randomUUID() }) } },
              { id: 'status', type: 'function', function: { name: tool('application.set_status'), arguments: JSON.stringify({ jobId, status: 'APPLIED' }) } }
            ] : []
            if (calls.length) {
              response.write(sse({ content: observations ? 'Updating your application.' : 'Reading your saved records.' }))
              const timer = setTimeout(() => response.end(sse({ tool_calls: calls.map((c, index) => ({ index, ...c })) }, 'tool_calls') + 'data: [DONE]\n\n'), 150)
              response.on('close', () => clearTimeout(timer))
            } else finish(response, '## Your application is updated\n\n' + Array.from({length: 32}, (_, i) => `- Result ${i + 1}: saved job and profile checked.`).join('\n') + '\n\n| Field | Value |\n| --- | --- |\n| Status | Applied |\n\n```text\n' + 'wide-output-'.repeat(100) + '\n```')
          })
        })
        await new Promise(r => server.listen(0, '127.0.0.1', r))
        const ai = { providers: [{ id: 'ask-fixture', name: 'Fixture', baseURL: `http://127.0.0.1:${server.address().port}`, requiresKey: false, models: ['fixture-model'], defaultModel: 'fixture-model', capabilities: { 'fixture-model': { contextWindow: 65536, maxOutputTokens: 8192, source: 'manual', verified: true } } }], default: { providerId: 'ask-fixture', modelId: 'fixture-model' } }
        assert((await data('settings', 'savePreferences', { ai, language: 'en', theme: 'light' })).ok)
        await evaluate("window.browser.navigate('app://ai')")
        await waitFor(() => evaluate('!!document.querySelector(".ai-composer textarea")'), 'composer')
        if (stage === 'restart') {
          assert((await data('chats', 'listSessions', {})).value.total >= 4)
          const old = (await api('getRun', { runId: metadata.workflowRun })).value
          assert.equal(old.run.state, 'completed'); assert.equal(old.items.filter(i => i.content.type === 'tool_call' && !i.content.toolName.startsWith('tool.')).length, 5)
          await select('workflow'); await waitFor(() => evaluate('document.body.innerText.includes("Your application is updated")'), 'persistent timeline')
          await click('New chat'); await send('crash checkpoint')
          await waitFor(async () => (await api('listActive', {})).value.some(s => s.items.some(i => i.content.text?.includes('Checkpoint'))), 'crash partial output')
          const active = (await api('listActive', {})).value.find(s => s.items.some(i => i.content.text?.includes('Checkpoint')))
          await waitFor(async () => (await data('chats', 'listItems', { sessionId: active.run.sessionId })).value.items.some(i => i.content.text?.includes('Checkpoint')), 'durable checkpoint')
          metadata.crashRun = active.run.id; writeFileSync(metadataPath, JSON.stringify(metadata))
          // A real abrupt exit bypasses task disposal; next process must recover the dead owner.
          console.log('Ask AI restart smoke passed: sessions, complete timeline and model selection restored; terminating an active run for recovery.')
          clearTimeout(watchdog); process.kill(process.pid, 'SIGKILL'); return
        }
        const job = await data('jobs', 'saveJob', { details: { title: 'Smoke engineer', companyNameRaw: 'Fixture company' } }); assert(job.ok); jobId = job.value.id; metadata.jobId = jobId
        assert((await data('profiles', 'createProfile', { name: 'Smoke profile' })).ok)
        await evaluate('window.__askEvents=[];window.askAgent.onEvent(e=>window.__askEvents.push(e));void 0')
        await send('workflow')
        await waitFor(() => evaluate('!!document.querySelector("[data-item-type=reasoning][data-item-state=streaming]")'), 'reasoning streaming')
        await waitFor(async () => (await data('chats', 'listRuns', { sessionId: (await data('chats', 'listSessions', {})).value.items[0].id })).value.items[0]?.state === 'completed', 'workflow completion')
        const workflow = (await data('chats', 'listSessions', {})).value.items.find(s => s.title === 'workflow')
        metadata.workflowRun = (await data('chats', 'listRuns', { sessionId: workflow.id })).value.items[0].id
        await chatDebugSmoke({ window, evaluate, data, click, frame, waitFor, directory, session: workflow })
        const snapshot = (await api('getRun', { runId: metadata.workflowRun })).value
        assert.equal(snapshot.items.filter(i => i.content.type === 'tool_call' && !i.content.toolName.startsWith('tool.')).length, 5)
        assert.equal(JSON.stringify(snapshot).includes('PRIVATE_NOTE_RESULT'), true)
        assert.equal(JSON.stringify(snapshot).includes('OPAQUE_PROVIDER_STATE'), false)
        assert.equal(JSON.stringify(snapshot).includes('PRIVATE_SIGNATURE'), false)
        assert(snapshot.items.some(i => i.content.type === 'reasoning' && i.content.reasoning.kind === 'encrypted'))
        assert(snapshot.items.some(i => i.content.type === 'reasoning' && i.content.text === 'Full provider reasoning 中文'))
        assert.equal(snapshot.items.filter(i => i.content.type === 'reasoning' && i.content.text === 'Full provider reasoning 中文').length,
          snapshot.items.filter(i => i.content.type === 'reasoning' && i.content.reasoning.kind === 'encrypted').length)
        await evaluate(`document.querySelectorAll('[data-item-type=reasoning] .ui-collapsible > button').forEach(b=>b.click())`)
        await frame()
        assert(await evaluate('document.body.innerText.includes("Reasoning summary") && document.body.innerText.includes("readable text is unavailable")'))
        await evaluate(`document.querySelectorAll('[data-item-type=tool_call] .ui-collapsible > button').forEach(b=>b.click())`)
        await frame()
        assert(await evaluate('document.body.innerText.includes("PRIVATE_NOTE_RESULT") && document.body.innerText.includes("Arguments · JSON") && document.body.innerText.includes("Call ID")'))
        await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text}}});document.querySelector('[data-item-type=tool_call] .ui-code-heading button').click()`)
        await frame(); assert.equal(await evaluate('window.__copied'), JSON.stringify(snapshot.items.find(i=>i.content.type==='tool_call').content.arguments, null, 2))
        await evaluate(`document.querySelectorAll('[data-item-type=tool_call] .ui-collapsible > button, [data-item-type=reasoning] .ui-collapsible > button').forEach(b=>b.click())`)
        assert.equal((await data('jobs', 'getJob', { id: jobId })).value.applicationStatus, 'APPLIED')
        const captured = await evaluate('window.__askEvents')
        assert(captured.some(e => e.type === 'item.started' && e.item.content.type === 'tool_call' && e.item.state === 'running'))
        assert(captured.some(e => e.type === 'item.completed' && e.item.content.type === 'tool_call'))
        assert(captured.some(e => e.type === 'item.delta'))
        await waitFor(() => evaluate('document.querySelector(".ai-transcript").scrollHeight > document.querySelector(".ai-transcript").clientHeight'), 'scrollable output')
        await evaluate('document.querySelector(".ai-transcript").scrollTop=0'); await frame()
        assert(await evaluate('!!document.querySelector(".ai-new-output")'))
        await click('↓ View new output'); await frame()
        assert.equal(await evaluate('document.querySelectorAll(".ui-markdown table").length'), 1)
        await click('New chat'); await send('archive loop')
        await waitFor(() => evaluate('!!document.querySelector("[data-run-state=failed]")'), 'guard termination visible')
        const guarded = (await data('chats', 'listSessions', {})).value.items.find(s => s.title === 'archive loop')
        const guardRun = (await data('chats', 'listRuns', { sessionId: guarded.id })).value.items[0]
        assert.equal(guardRun.error, 'TOOL_GUARD_TERMINATED')
        const guardSnapshot = (await api('getRun', { runId: guardRun.id })).value
        const guardCalls = guardSnapshot.items.filter(i => i.content.toolName === 'job.set_archived')
        assert.deepEqual(guardCalls.map(i => i.state), ['completed', 'failed', 'failed', 'failed'])
        assert(guardCalls.slice(1).every(i => i.content.guard.executed === false))
        assert((await data('jobs', 'getJob', { id: jobId })).value.archivedAt)
        await evaluate(`document.querySelectorAll('[data-item-type=tool_call] .ui-collapsible > button').forEach(b=>b.click())`)
        await frame()
        assert(await evaluate('document.body.innerText.includes("Not executed") && document.body.innerText.includes("Confirmed effect") && document.body.innerText.includes("Rejected calls")'))
        window.setMinimumSize(320, 320); window.setContentSize(320, 820)
        await waitFor(() => evaluate('innerWidth===320'), 'guard narrow resize'); await frame()
        assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false)
        mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
        writeFileSync(resolve(__dirname, '../.cache/ask-ai-guard-narrow.png'), (await window.capturePage()).toPNG())
        window.setContentSize(1200, 820); await waitFor(() => evaluate('innerWidth===1200'), 'restore guard width'); await frame()
        await click('New chat'); await send('read recovery')
        await waitFor(() => evaluate('document.body.innerText.includes("Answered from confirmed information after recovery.")'), 'recovery answer')
        const recovered = (await data('chats', 'listSessions', {})).value.items.find(s => s.title === 'read recovery')
        const recoveredRun = (await data('chats', 'listRuns', { sessionId: recovered.id })).value.items[0]
        const recoveredSnapshot = (await api('getRun', { runId: recoveredRun.id })).value
        assert.equal(recoveredRun.state, 'completed'); assert.equal(recoveredRun.writeStarted, false)
        assert.equal(recoveredSnapshot.items.filter(i => i.content.toolName === 'job.list').length, 4)
        assert(!recoveredSnapshot.items.some(i => i.content.toolName === 'application.add_note'))
        await evaluate(`document.querySelectorAll('[data-item-type=tool_call] .ui-collapsible > button').forEach(b=>b.click())`); await frame()
        assert(await evaluate('document.body.innerText.includes("Warning") && document.body.innerText.includes("Recovery") && document.body.innerText.includes("Next action")'))
        for (const language of ['zh-CN', 'en']) {
          assert((await data('settings', 'savePreferences', { language })).ok)
          await waitFor(() => evaluate(`document.body.innerText.includes(${JSON.stringify(language === 'zh-CN' ? '下一步' : 'Next action')})`), 'localized recovery guidance')
          window.setContentSize(320, 820); await waitFor(() => evaluate('innerWidth===320'), 'recovery narrow resize'); await frame()
          assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false)
        }
        writeFileSync(resolve(__dirname, '../.cache/ask-ai-recovery-narrow.png'), (await window.capturePage()).toPNG())
        window.setContentSize(1200, 820); await waitFor(() => evaluate('innerWidth===1200'), 'restore recovery width'); await frame()
        await click('New chat'); await send('hold reasoning')
        await waitFor(() => evaluate('!!document.querySelector("[data-item-type=reasoning][data-item-state=streaming] .ui-code-block")'), 'live readable reasoning')
        assert.equal(await evaluate('document.querySelector("[data-item-state=streaming] .ui-collapsible > button").getAttribute("aria-expanded")'), 'true')
        await evaluate('document.querySelector("[data-item-state=streaming] .ui-collapsible > button").click()')
        await waitFor(() => Boolean(releases['hold reasoning']), 'reasoning release'); releases['hold reasoning']()
        await waitFor(async () => (await api('listActive', {})).value.length === 0, 'reasoning completed')
        await frame()
        assert.equal(await evaluate('[...document.querySelectorAll("[data-item-type=reasoning] .ui-collapsible > button")].at(-1).getAttribute("aria-expanded")'), 'false')
        await evaluate('[...document.querySelectorAll("[data-item-type=reasoning] .ui-collapsible > button")].at(-1).click()')
        await frame(); assert(await evaluate('document.body.innerText.includes(" still thinking")'))
        await click('New chat'); await send('hold A')
        await waitFor(async () => (await api('listActive', {})).value.length === 1, 'A active')
        const runningSession = (await data('chats', 'listSessions', {})).value.items.find(s => s.title === 'hold A')
        await chatDebugSmoke({ window, evaluate, data, click, frame, waitFor, directory, session: runningSession, running: true })
        await field('next draft A'); await click('New chat'); await send('hold B')
        await waitFor(async () => (await api('listActive', {})).value.length === 2, 'A and B active')
        window.setMinimumSize(320, 320); window.setContentSize(320, 820)
        await waitFor(() => evaluate('innerWidth===320'), 'busy narrow resize'); await frame()
        assert.equal(await evaluate('document.querySelector(".ai-composer").scrollWidth>document.querySelector(".ai-composer").clientWidth'), false)
        assert(await evaluate(`(() => { const rows = [...document.querySelector('.ui-composer-controls').children].map(node => node.getBoundingClientRect().top); return Math.max(...rows) - Math.min(...rows) < 1; })()`))
        assert(await evaluate(`!!document.querySelector('button[aria-label=Stop]') && !!document.querySelector('button[aria-label="Send message"]')`))
        mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
        writeFileSync(resolve(__dirname, '../.cache/ask-ai-busy-narrow.png'), (await window.capturePage()).toPNG())
        window.setContentSize(1200, 820); await waitFor(() => evaluate('innerWidth===1200'), 'restore busy width'); await frame()
        await evaluate("window.browser.navigate('app://browser')"); assert.equal((await api('listActive', {})).value.length, 2)
        await evaluate("window.browser.navigate('app://ai')"); await waitFor(() => evaluate('!!document.querySelector(".ai-composer")'), 'page return')
        await select('hold A'); assert.equal(await evaluate('document.querySelector(".ai-composer textarea").value'), 'next draft A')
        await evaluate('document.querySelector("button[aria-label=Stop]").click()')
        await waitFor(async () => (await api('listActive', {})).value.length === 1, 'A stopped independently')
        assert.equal((await api('listActive', {})).value[0].items[0].content.text, 'hold B')
        await waitFor(() => Boolean(releases['hold B']), 'B streaming fixture'); releases['hold B'](); await waitFor(async () => (await api('listActive', {})).value.length === 0, 'B completes')
        await click('New chat'); await send('failure')
        await waitFor(() => evaluate('!!document.querySelector("[data-run-state=failed]")'), 'failed run visible')
        await click('Retry'); await waitFor(() => evaluate('document.body.innerText.includes("Recovered answer")'), 'retry as new run')
        await click('New chat'); await field('housekeeping')
        const beforeIme = (await data('chats', 'listSessions', {})).value.total
        await evaluate(`(() => { const c=document.querySelector('.ai-composer textarea'); c.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})); c.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true})); })()`)
        await frame(); assert.equal((await data('chats', 'listSessions', {})).value.total, beforeIme)
        await evaluate("document.querySelector('.ai-composer').requestSubmit()")
        await waitFor(() => evaluate('document.body.innerText.includes("Recovered answer")'), 'housekeeping answer')
        const openActions = title => evaluate(`[...document.querySelectorAll('.ui-session-entry')].find(row=>row.querySelector('.ui-session-title').textContent===${JSON.stringify(title)}).querySelector('button[aria-label]').click()`)
        await openActions('housekeeping'); await click('Rename')
        await evaluate(`(() => { const c=document.querySelector('.ui-dialog input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(c,'Renamed chat'); c.dispatchEvent(new Event('input',{bubbles:true})); })()`); await frame(); await click('Save')
        await waitFor(async () => (await data('chats', 'listSessions', {})).value.items.some(s=>s.title==='Renamed chat'), 'renamed session')
        await openActions('Renamed chat'); await click('Delete chat'); await frame(); await click('Delete chat')
        await waitFor(async () => (await data('chats', 'listSessions', {})).value.total===beforeIme, 'deleted session')
        assert.equal((await data('jobs', 'getJob', {id:jobId})).value.applicationStatus,'APPLIED')
        await select('workflow')
        await evaluate(`document.querySelectorAll('[data-item-type=tool_call] .ui-collapsible > button, [data-item-type=reasoning] .ui-collapsible > button').forEach(b=>{if(b.getAttribute('aria-expanded')==='false')b.click()})`)
        await frame()
        window.setMinimumSize(320, 320)
        mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
        for (const language of ['en', 'zh-CN']) for (const theme of ['light', 'dark']) {
          assert((await data('settings', 'savePreferences', { language, theme })).ok)
          for (const width of [320, 640, 1200]) {
            window.setContentSize(width, 820); await waitFor(() => evaluate(`innerWidth===${width}`), 'resize'); await frame()
            await chatDebugLayoutSmoke({ window, evaluate, click, frame, waitFor, language, width, session: workflow })
            assert.equal(await evaluate('document.querySelector(".ai-page").scrollWidth>document.querySelector(".ai-page").clientWidth'), false)
            assert.equal(await evaluate('document.querySelector(".ai-composer").scrollWidth>document.querySelector(".ai-composer").clientWidth'), false)
          }
          writeFileSync(resolve(__dirname, `../.cache/ask-ai-${language}-${theme}.png`), (await window.capturePage()).toPNG())
        }
        window.setContentSize(320, 820); await frame()
        await evaluate('document.querySelector(".ai-session-toggle button").click()'); await frame()
        assert(await evaluate('document.querySelector(".ui-drawer").open'))
        writeFileSync(resolve(__dirname, '../.cache/ask-ai-narrow.png'), (await window.capturePage()).toPNG())
        await evaluate('document.querySelector(".ui-drawer-heading button").click()')
        await data('settings', 'savePreferences', { language: 'en', theme: 'light' })
        const outsider = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
        await outsider.loadURL('data:text/html,<p>Untrusted</p>')
        assert.deepEqual(await outsider.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('ask-agent:call','start',{})"), { ok: false, error: 'FORBIDDEN' }); outsider.destroy()
        writeFileSync(metadataPath, JSON.stringify(metadata))
        console.log('Ask AI smoke passed: real SSE/IPC/MCP read and write, full provider reasoning/summary/opaque markers and continuation, full tool details, interleaved tools, A/B concurrency, targeted Stop, page remount, drafts, IME, rename/delete, retry, confirmed full persisted debug JSON, running export, clipboard failure/retry, zero-call cancellation, keyboard copy, Markdown, pinned scrolling, bilingual themes, 320/640/1200px and rejected untrusted IPC.')
      }
      server?.closeAllConnections(); server?.close()
      app.once('will-quit', () => { clearTimeout(watchdog); app.exit(0) }); app.quit()
    } catch (error) { console.error(error); console.error(await evaluate('document.body.innerText')); console.error(await api('listActive', {})); server?.closeAllConnections(); server?.close(); clearTimeout(watchdog); app.exit(1) }
  })
})
require(resolve(__dirname, '../out/main/index.js'))
