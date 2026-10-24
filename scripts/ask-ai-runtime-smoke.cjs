const { app, BrowserWindow } = require('electron')
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
        const finish = (response, text) => response.end(sse({ content: text }, 'stop') + 'data: [DONE]\n\n')
        server = createServer((request, response) => {
          let raw = ''; request.on('data', c => { raw += c }); request.on('end', async () => {
            const body = JSON.parse(raw), user = body.messages.findLast(m => m.role === 'user').content, lastUser = body.messages.findLastIndex(m => m.role === 'user')
            const observations = body.messages.slice(lastUser).filter(m => m.role === 'tool').length
            response.writeHead(200, { 'Content-Type': 'text/event-stream' })
            response.write(sse({ reasoning_summary: 'Comparing saved job information 中文' }))
            await new Promise(r => setTimeout(r, 150))
            if (user.startsWith('hold')) { response.write(sse({ content: `Working ${user}` })); releases[user] = () => finish(response, ' completed'); return }
            if (user === 'crash checkpoint') { response.write(sse({ content: 'Checkpoint survives process termination.' })); return }
            if (user === 'failure' && failCount++ === 0) { response.end(sse({ content: 'Partial response' }) + 'data: [DONE]\n\n'); return }
            if (user !== 'workflow') { finish(response, 'Recovered answer'); return }
            const tool = prefix => { const entry = body.tools.find(t => t.function.description.startsWith(prefix)); assert(entry); return entry.function.name }
            const calls = observations === 0 ? [
              { id: 'jobs', type: 'function', function: { name: tool('List saved jobs;'), arguments: '{}' } },
              { id: 'profiles', type: 'function', function: { name: tool('List saved profiles'), arguments: '{}' } },
              { id: 'state', type: 'function', function: { name: tool('Read current application'), arguments: JSON.stringify({ jobId }) } }
            ] : observations === 3 ? [
              { id: 'note', type: 'function', function: { name: tool('Append a note'), arguments: JSON.stringify({ jobId, text: 'PRIVATE_NOTE_RESULT', requestId: randomUUID() }) } },
              { id: 'status', type: 'function', function: { name: tool('Apply a legal status'), arguments: JSON.stringify({ jobId, status: 'APPLIED' }) } }
            ] : []
            if (calls.length) {
              response.write(sse({ content: observations ? 'Updating your application.' : 'Reading your saved records.' }))
              const timer = setTimeout(() => response.end(sse({ tool_calls: calls.map((c, index) => ({ index, ...c })) }, 'tool_calls') + 'data: [DONE]\n\n'), 150)
              response.on('close', () => clearTimeout(timer))
            } else finish(response, '## Your application is updated\n\n' + Array.from({length: 32}, (_, i) => `- Result ${i + 1}: saved job and profile checked.`).join('\n') + '\n\n| Field | Value |\n| --- | --- |\n| Status | Applied |\n\n```text\n' + 'wide-output-'.repeat(100) + '\n```')
          })
        })
        await new Promise(r => server.listen(0, '127.0.0.1', r))
        const ai = { providers: [{ id: 'ask-fixture', name: 'Fixture', baseURL: `http://127.0.0.1:${server.address().port}`, requiresKey: false, models: ['fixture-model'], defaultModel: 'fixture-model' }], default: { providerId: 'ask-fixture', modelId: 'fixture-model' } }
        assert((await data('settings', 'savePreferences', { ai, language: 'en', theme: 'light' })).ok)
        await evaluate("window.browser.navigate('app://ai')")
        await waitFor(() => evaluate('!!document.querySelector(".ai-composer textarea")'), 'composer')
        if (stage === 'restart') {
          assert((await data('chats', 'listSessions', {})).value.total >= 4)
          const old = (await api('getRun', { runId: metadata.workflowRun })).value
          assert.equal(old.run.state, 'completed'); assert.equal(old.items.filter(i => i.content.type === 'tool_call').length, 5)
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
        const snapshot = (await api('getRun', { runId: metadata.workflowRun })).value
        assert.equal(snapshot.items.filter(i => i.content.type === 'tool_call').length, 5)
        assert.equal(JSON.stringify(snapshot).includes('PRIVATE_NOTE_RESULT'), false)
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
        await click('New chat'); await send('hold A')
        await waitFor(async () => (await api('listActive', {})).value.length === 1, 'A active')
        await field('next draft A'); await click('New chat'); await send('hold B')
        await waitFor(async () => (await api('listActive', {})).value.length === 2, 'A and B active')
        await evaluate("window.browser.navigate('app://home')"); assert.equal((await api('listActive', {})).value.length, 2)
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
        window.setMinimumSize(320, 320)
        mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
        for (const language of ['en', 'zh-CN']) for (const theme of ['light', 'dark']) {
          assert((await data('settings', 'savePreferences', { language, theme })).ok)
          for (const width of [320, 640, 1200]) {
            window.setContentSize(width, 820); await waitFor(() => evaluate(`innerWidth===${width}`), 'resize'); await frame()
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
        console.log('Ask AI smoke passed: real SSE/IPC/MCP read and write, public reasoning, interleaved tools, A/B concurrency, targeted Stop, page remount, drafts, IME, rename/delete, retry, Markdown, pinned scrolling, bilingual themes, 320/640/1200px and rejected untrusted IPC.')
      }
      server?.closeAllConnections(); server?.close()
      app.once('will-quit', () => { clearTimeout(watchdog); app.exit(0) }); app.quit()
    } catch (error) { console.error(error); console.error(await evaluate('document.body.innerText')); console.error(await api('listActive', {})); server?.closeAllConnections(); server?.close(); clearTimeout(watchdog); app.exit(1) }
  })
})
require(resolve(__dirname, '../out/main/index.js'))
