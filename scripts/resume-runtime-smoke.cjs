const { app, dialog } = require('electron')
const assert = require('node:assert/strict')
const { resolve, join } = require('node:path')
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs')
const { resumeFixture } = require('../.cache/tests/tests/resume-fixture.js')
assert(process.env.JOB_BROWSER_SMOKE_DATA)
app.setPath('userData', process.env.JOB_BROWSER_SMOKE_DATA)
const timer = setTimeout(() => { console.error('Resume UI smoke timed out'); app.exit(1) }, 50000)
let server
app.once('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    const evaluate = code => window.webContents.executeJavaScript(`(async () => (${code}))()`)
    const data = (group, method, args) => evaluate(`window.data.${group}.${method}(${JSON.stringify(args)})`).then(result => { assert(result.ok, result.error); return result.value })
    const wait = async (check, label) => { const until = Date.now() + 15000; while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)) }; throw new Error(`Timed out: ${label}`) }
    const click = async text => { await wait(() => evaluate(`[...document.querySelectorAll('.resume-page button')].some(button => button.textContent === ${JSON.stringify(text)} && !button.disabled)`), text); await evaluate(`[...document.querySelectorAll('.resume-page button')].find(button => button.textContent === ${JSON.stringify(text)} && !button.disabled).click()`) }
    try {
      const profile = await data('profiles', 'createProfile', { name: '林测试 Resume Fixture', email: 'fixture@example.com', links: [{ label: 'Portfolio', url: 'https://example.com/作品' }] })
      const item = await data('profiles', 'addItem', { profileId: profile.id, details: { type: 'EXPERIENCE', title: '软件工程师 Engineer', organization: '本地测试公司', metadata: { startDateText: '2020', endDateText: '2024-06' } } })
      const fact = await data('profiles', 'addFact', { profileId: profile.id, profileItemId: item.id, details: { kind: 'ACHIEVEMENT', content: '开发中文服务并使用 TypeScript 完成测试。' } })
      await data('jobs', 'saveJob', { details: { title: '软件工程师', companyNameRaw: 'Fixture', description: '岗位职责：开发服务，使用 TypeScript。要求：测试与协作。' } })
      await evaluate('window.browser.navigate("app://resume")')
      await click('Tailor Resume')
      await wait(() => evaluate('document.body.innerText.includes("Choose a model") || document.body.innerText.includes("Configure") || document.querySelector("[role=alert]")'), 'missing settings error')
      await data('settings', 'savePreferences', { ai: { providers: [{ id: 'fixture', name: 'Fixture', baseURL: server.url, requiresKey: false, models: ['fixture'], defaultModel: 'fixture' }], default: { providerId: 'fixture', modelId: 'fixture' } } })
      await click('Tailor Resume')
      await evaluate('window.browser.navigate("app://ai")')
      await evaluate('window.browser.navigate("app://resume")')
      await wait(() => evaluate('!!document.querySelector(".ui-document-preview")'), 'automatic HTML and PDF output')
      const task = (await evaluate('window.resume.getTask({})')).value
      assert.equal(task.run.state, 'PUBLISHED'); assert.equal(task.artifact.content.language, 'zh-CN'); assert.equal(task.artifact.output.status, 'READY')
      assert(task.run.assembled)
      const traceCard = label => `[...document.querySelectorAll('.resume-content > details')].find(card => card.querySelector('.ui-section-title')?.textContent === ${JSON.stringify(label)})`
      const trace = traceCard('Agent trace')
      assert.equal(await evaluate(`${trace}.open`), false)
      assert.equal(await evaluate(`${trace}.previousElementSibling.querySelector('.ui-section-title').textContent`), 'Generation progress')
      await evaluate(`${trace}.querySelector('summary').click()`)
      await wait(() => evaluate('document.body.innerText.includes("ReAct cycles") && document.body.innerText.includes("Model requests")'), 'shared trace')
      assert.equal(await evaluate('!!document.querySelector(".ui-drawer[open]")'), false)
      await evaluate(`${trace}.querySelector('button').click()`)
      assert.equal(await evaluate(`${trace}.open`), true)
      await evaluate(`${trace}.querySelector('summary').focus()`)
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
      await wait(() => evaluate(`!${trace}.open`), 'keyboard collapse trace card')
      assert.equal(task.artifact.content.experience[0].bullets[0].factIds[0], fact.id)
      assert.deepEqual(task.artifact.outputFiles.map(file => file.format), ['HTML', 'PDF'])
      const preview = (await evaluate(`window.resume.getPreview({artifactId:${JSON.stringify(task.artifact.id)}})`)).value
      assert(preview.html.includes('林测试')); assert(!/<script/i.test(preview.html)); assert(preview.html.includes('data:font/ttf'))
      const iframe = await evaluate('({sandbox:document.querySelector("iframe").getAttribute("sandbox"), title:document.querySelector("iframe").title})')
      assert.equal(iframe.sandbox, '')
      const pdfPath = join(process.env.JOB_BROWSER_SMOKE_DATA, 'artifacts', task.artifact.outputFiles.find(file => file.format === 'PDF').relativePath)
      assert(existsSync(pdfPath))
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), useSystemFonts: false }).promise
      assert.equal(pdf.numPages, preview.pages)
      let text = ''
      for (let page = 1; page <= pdf.numPages; page++) { const p = await pdf.getPage(page); const view = p.getViewport({ scale: 1 }); assert(Math.abs(view.width - 595.28) < 1); assert(Math.abs(view.height - 841.89) < 1); text += (await p.getTextContent()).items.map(item => item.str).join('') }
      await pdf.loadingTask.destroy()
      assert(text.includes('林测试')); assert(text.includes('TypeScript')); assert(text.normalize('NFKC').replace(/\s/g, '').includes('开发中文服务'), JSON.stringify(text))
      const exported = join(process.env.JOB_BROWSER_SMOKE_DATA, 'saved-resume.pdf')
      const requestsBeforeExport = server.requests()
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: join(process.env.JOB_BROWSER_SMOKE_DATA, 'missing-directory', 'failed.pdf') })
      await click('Export PDF')
      await wait(() => evaluate('document.body.innerText.includes("The PDF could not be saved")'), 'failed export has its own recoverable message')
      assert.equal((await evaluate('window.resume.getTask({})')).value.artifact.output.status, 'READY')
      assert.equal(server.requests(), requestsBeforeExport)
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported })
      await click('Export PDF'); await wait(() => Promise.resolve(existsSync(exported)), 'system save copies managed PDF')
      assert.deepEqual(readFileSync(exported), readFileSync(pdfPath))
      const before = server.requests()
      await click('Rebuild HTML / PDF'); await wait(() => evaluate('window.resume.getTask({}).then(result => result.ok && !result.value.active && result.value.artifact.output.status === "READY")'), 'output retry terminal state'); await wait(() => evaluate('!!document.querySelector(".ui-document-preview")'), 'output-only retry')
      assert.equal(server.requests(), before)
      assert.equal(await evaluate(`!!document.querySelector('section[aria-label="Edit this resume"]')`), true)
      assert.equal(await evaluate('!!document.querySelector(".resume-page details details details")'), false)
      assert.equal(await evaluate('document.querySelector(".resume-page").textContent.includes("Statement sources")'), false)
      await evaluate(`(() => {
        const input = document.querySelector('section[aria-label="Edit this resume"] input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Edited resume contact');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`)
      await evaluate(`(() => {
        const region = document.querySelector('section[aria-label="Edit this resume"]');
        const label = [...region.querySelectorAll('label')].find(element => element.textContent === 'URL');
        const input = document.getElementById(label.htmlFor);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'portfolio.example/my work');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`)
      await click('Edit')
      await wait(() => evaluate('!!document.querySelector("dialog[open] form")'), 'resume entry dialog')
      for (const [label, value] of [['Title', '手工编辑的项目名称'], ['Organization', ''], ['Start date', 'Summer 2020 (part-time)'], ['End date', '毕业后'], ['URL', 'github.com/example/project']]) {
        await evaluate(`(() => {
          const label = [...document.querySelectorAll('dialog[open] label')].find(element => element.textContent === ${JSON.stringify(label)});
          const input = document.getElementById(label.htmlFor);
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`)
      }
      await click('Save')
      await wait(() => evaluate('!document.querySelector("dialog[open]")'), 'manual entry accepted')
      await wait(() => evaluate(`!document.querySelector('section[aria-label="Work experience"] .profile-facts button').disabled`), 'resume bullet edit available')
      await evaluate(`document.querySelector('section[aria-label="Work experience"] .profile-facts button').click()`)
      await wait(() => evaluate('!!document.querySelector("dialog[open] textarea")'), 'resume bullet dialog')
      await evaluate(`(() => {
        const input = document.querySelector('dialog[open] textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '手动修改的要点内容');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`)
      await click('Save')
      await wait(() => evaluate('!document.querySelector("dialog[open]")'), 'manual bullet accepted')
      await click('Save and rebuild PDF')
      await wait(() => evaluate('window.resume.getTask({}).then(result => result.ok && !result.value.active && result.value.artifact.revision === 2 && result.value.artifact.output.status === "READY")'), 'edited resume rebuild')
      const edited = (await evaluate('window.resume.getTask({})')).value
      assert.equal(edited.artifact.content.basics.name, 'Edited resume contact')
      assert.equal(edited.artifact.content.basics.links[0].url, 'portfolio.example/my work')
      assert.equal(edited.artifact.content.experience[0].startDate, 'Summer 2020 (part-time)')
      assert.equal(edited.artifact.content.experience[0].endDate, '毕业后')
      assert.equal(edited.artifact.content.experience[0].url, 'github.com/example/project')
      assert.equal(edited.artifact.content.experience[0].bullets[0].text, '手动修改的要点内容')
      assert.deepEqual(edited.artifact.content.experience[0].bullets[0].factIds, [])
      const rebuilt = (await evaluate(`window.resume.getPreview({artifactId:${JSON.stringify(task.artifact.id)}})`)).value
      for (const text of ['portfolio.example/my work', 'Summer 2020 (part-time)', '毕业后', 'github.com/example/project', '手动修改的要点内容']) assert(rebuilt.html.includes(text))
      assert.equal((await data('profiles', 'getProfile', { id: profile.id })).name, profile.name)
      assert.equal(server.requests(), before)
      // Document container remains opaque and every UI control uses central components.
      window.setMinimumSize(320, 320); mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
      for (const language of ['en', 'zh-CN']) for (const theme of ['light', 'dark']) {
        await data('settings', 'savePreferences', { language, theme })
        for (const width of [320, 640, 1200]) {
          window.setContentSize(width, 820)
          await wait(() => evaluate(`innerWidth===${width} && document.documentElement.lang===${JSON.stringify(language)} && document.documentElement.dataset.theme===${JSON.stringify(theme)}`), 'resume responsive locale')
          assert.equal(await evaluate('document.querySelector(".resume-page").scrollWidth > document.querySelector(".resume-page").clientWidth'), false)
          writeFileSync(resolve(__dirname, `../.cache/resume-${language}-${theme}-${width}.png`), (await window.capturePage()).toPNG())
          const localizedTrace = traceCard(language === 'en' ? 'Agent trace' : 'Agent 运行追踪')
          await evaluate(`${localizedTrace}.querySelector('summary').click()`)
          await wait(() => evaluate(`${localizedTrace}.open`), 'expanded inline trace')
          await evaluate(`${localizedTrace}.scrollIntoView({ block: 'start' })`)
          assert.equal(await evaluate('document.querySelector(".resume-page").scrollWidth > document.querySelector(".resume-page").clientWidth'), false)
          writeFileSync(resolve(__dirname, `../.cache/resume-trace-${language}-${theme}-${width}.png`), (await window.capturePage()).toPNG())
          await evaluate(`${localizedTrace}.querySelector('summary').click()`)
          await wait(() => evaluate(`!${localizedTrace}.open`), 'collapsed inline trace')
        }
      }
      // Simulate a crash after files reached disk but before their metadata was committed.
      const backend = require('../.cache/tests/src/platform/database/backend.js').createBackend(join(process.env.JOB_BROWSER_SMOKE_DATA, 'database.sqlite'))
      backend.generation.recordOutputFiles({ id: task.artifact.id, files: [] })
      backend.generation.recordOutputState({ id: task.artifact.id, output: { status: 'RUNNING', error: null, pages: null } })
      backend.close()
      const pending = await data('resumes', 'createRun', { jobId: task.run.jobId, profileId: profile.id })
      writeFileSync(join(process.env.JOB_BROWSER_SMOKE_DATA, 'resume-receipt.json'), JSON.stringify({ runId: task.run.id, artifactId: task.artifact.id, pendingId: pending.id }))
      const { BrowserWindow } = require('electron'), { DatabaseSync } = require('node:sqlite')
      const keepAlive = new BrowserWindow({ show: false })
      const callsBeforeClose = server.requests(); server.hook(stage => stage === 'rewrite')
      const closing = await evaluate(`window.resume.start({jobId:${JSON.stringify(task.run.jobId)},profileId:${JSON.stringify(profile.id)}})`)
      assert(closing.ok)
      await wait(() => Promise.resolve(server.requests() > callsBeforeClose), 'model request before window destruction')
      window.destroy(); await new Promise(resolve => setImmediate(resolve))
      const inspection = new DatabaseSync(join(process.env.JOB_BROWSER_SMOKE_DATA, 'database.sqlite'), { readOnly: true })
      await wait(() => inspection.prepare('SELECT state FROM generation_runs WHERE id=?').get(closing.value.runId).state === 'CANCELLED', 'window disposal cancels run')
      assert.equal(inspection.prepare('SELECT count(*) n FROM artifacts WHERE generation_run_id=?').get(closing.value.runId).n, 0)
      inspection.close(); keepAlive.destroy()
      console.log('Resume UI smoke passed: local model/tool loop, immutable Artifact sources, Chinese/English PDF text, A4 page parity, preview, save, output retry, navigation recovery and bilingual responsive themes.')
      clearTimeout(timer); await server.close(); app.exit(0)
    } catch (error) { clearTimeout(timer); console.error(error); try { console.error(await evaluate('document.body.innerText')); console.error(await evaluate('window.resume.getTask({})')) } catch {}; if (server) await server.close(); app.exit(1) }
  })
})
void resumeFixture().then(value => { server = value; require(resolve(__dirname, '../out/main/index.js')) })
