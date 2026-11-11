const { app, dialog } = require('electron')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { resolve } = require('node:path')
const { pdfFixture } = require('./profile-fixtures.cjs')
const { mkdirSync, writeFileSync } = require('node:fs')
const directory = process.env.JOB_BROWSER_SMOKE_DATA, stage = process.env.ONBOARDING_STAGE
assert(directory)
app.setPath('userData', directory)
require('./external-mcp-test-home.cjs')(directory)
const timer = setTimeout(() => { console.error('Onboarding smoke timed out'); app.exit(1) }, 40000)
process.on('uncaughtException', error => { console.error(error); app.exit(1) })
app.once('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false)
  window.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message) })
  window.webContents.once('did-finish-load', async () => {
    const evaluate = code => window.webContents.executeJavaScript(code)
    const wait = async (check, label) => { const end = Date.now() + 8000; while (!await check()) { if (Date.now() > end) throw Error(`Timed out: ${label}`); await new Promise(r => setTimeout(r, 20)) } }
    const frame = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    const button = async text => {
      await wait(() => evaluate(`[...document.querySelectorAll('button')].some(b => b.checkVisibility() && !b.disabled && (b.textContent === ${JSON.stringify(text)} || b.querySelector("strong")?.textContent === ${JSON.stringify(text)}))`), `button ${text}`)
      await evaluate(`[...document.querySelectorAll('button')].find(b => b.checkVisibility() && !b.disabled && (b.textContent === ${JSON.stringify(text)} || b.querySelector("strong")?.textContent === ${JSON.stringify(text)})).click()`); await frame()
    }
    const heading = text => wait(() => evaluate(`document.querySelector('.ui-wizard-card h1')?.textContent === ${JSON.stringify(text)}`), text)
    const data = (group, method, input = {}) => evaluate(`window.data.${group}.${method}(${JSON.stringify(input)})`)
    const field = async (label, value) => {
      await evaluate(`(() => { const label = [...document.querySelectorAll('.ui-field-label')].find(l => l.checkVisibility() && l.textContent === ${JSON.stringify(label)}); const input = document.getElementById(label.htmlFor); const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`); await frame()
    }
    let server
    try {
      if (stage === 'unfinished') {
        await heading('Language & background')
        assert.equal((await data('settings', 'get')).value.onboardingCompleted, false)
        assert.equal((await data('profiles', 'listProfiles')).value.total, 2)
      } else if (stage === 'restart') {
        await wait(() => evaluate('!!document.querySelector(".app-shell")'), 'completed startup skips setup')
        assert.equal((await data('settings', 'get')).value.onboardingCompleted, true)
        assert.equal((await data('profiles', 'listProfiles')).value.items[0].name, 'Setup candidate')
        await evaluate("window.browser.navigate('app://settings')")
        await wait(() => evaluate('!!document.querySelector("[data-settings-general]")'), 'settings ready')
        await require('./open-section-cards.cjs')(evaluate, '[data-settings-general]')
        assert.equal(await evaluate('document.querySelectorAll("[data-settings-general] .ui-language-background .ui-segmented").length'), 2)
        await button('Restart setup'); await heading('Language & background')
        assert.equal((await data('settings', 'get')).value.onboardingCompleted, false)
      } else {
        await heading('Language & background')
        assert.equal(await evaluate('!!document.querySelector(".ui-sidebar")'), false)
        window.setMinimumSize(320, 320)
        mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
        for (const lang of ['简体中文', 'English']) {
          await button(lang)
          for (const theme of lang === 'English' ? ['System', 'Light', 'Dark'] : ['跟随系统', '浅色', '深色']) {
            await button(theme)
            assert.deepEqual(await evaluate(`(() => { const group = document.querySelector('.onboarding-page .ui-segmented'), selected = group.querySelector('[aria-pressed=true]'), styles = getComputedStyle(group); return { height: group.getBoundingClientRect().height, inner: selected.getBoundingClientRect().height, padding: styles.padding, gap: styles.gap, radius: getComputedStyle(selected).borderRadius, selected: getComputedStyle(selected).backgroundColor !== styles.backgroundColor }; })()`), { height: 40, inner: 32, padding: '4px', gap: '4px', radius: '8px', selected: true })
            for (const width of [320, 640, 1200]) {
              window.setContentSize(width, 820); await wait(() => evaluate(`innerWidth === ${width}`), 'viewport'); await frame()
              assert.equal(await evaluate('document.querySelector(".onboarding-page").scrollWidth > innerWidth'), false)
            }
          }
        }
        writeFileSync(resolve(__dirname, '../.cache/onboarding-dark.png'), (await window.capturePage()).toPNG())
        await button('Light'); await button('Continue'); await heading('AI connection')
        await button('Connect external agents')
        assert.equal(await evaluate('document.querySelectorAll(".ui-stage-progress li").length'), 6)
        await button('Continue'); await heading('Model')
        let requests = 0, discovery = 0
        server = createServer((request, response) => {
          if (request.url === '/v1/models') {
            assert.equal(request.method, 'GET'); assert.equal(request.headers.authorization, undefined)
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ data: ++discovery === 1 ? [{ id: 'fixture-a' }, { id: 'fixture-b' }] : [{ id: 'fixture-single' }] }))
            return
          }
          request.resume(); request.on('end', () => {
            requests++
            response.writeHead(200, { 'Content-Type': 'text/event-stream' })
            response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ contact: { name: 'Setup candidate', introduction: 'Built the onboarding fixture.' }, links: [], items: [], facts: [], unmapped: [] }) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
          })
        })
        await new Promise(r => server.listen(0, '127.0.0.1', r))
        await field('Provider', 'local'); await field('Endpoint', `http://127.0.0.1:${server.address().port}/v1`)
        const initialAI = (await data('settings', 'get')).value.ai
        await button('Continue')
        await wait(() => evaluate('document.querySelectorAll(".ai-connection-results input[type=radio]").length === 2'), 'model discovery')
        assert.deepEqual((await data('settings', 'get')).value.ai, initialAI)
        assert.equal(await evaluate('document.querySelector("[data-onboarding-next]").disabled'), true)
        await evaluate('document.querySelectorAll(".ai-connection-results input[type=checkbox]")[0].click()')
        await evaluate('document.querySelectorAll(".ai-connection-results input[type=radio]")[1].click()')
        await button('Save changes'); await heading('Agent')
        assert.equal(requests, 0)
        await button('Install MCP'); await wait(() => evaluate('document.querySelector(".onboarding-agent-label")?.innerText.includes("Verified")'), 'real MCP handshake')
        await button('Install Skills'); await wait(() => evaluate('!document.querySelector("[data-onboarding-next]").disabled'), 'skills install complete')
        await button('Skip'); await heading('Profile')
        await field('Name', 'Setup candidate'); await field('Target role', 'Software engineer'); await field('About', 'Built the onboarding fixture.')
        await button('Save profile')
        await wait(async () => (await data('profiles', 'listProfiles')).value.total === 1, 'profile saved')
        await wait(() => evaluate('!document.querySelector("[data-onboarding-next]").disabled'), 'save complete')
        const profile = (await data('profiles', 'listProfiles')).value.items[0]
        assert.equal(profile.introduction, 'Built the onboarding fixture.')
        assert.equal((await data('profiles', 'listFacts', { profileId: profile.id })).value.items[0].content, 'Software engineer')
        await button('Back'); await heading('Agent'); await button('Skip'); await heading('Profile')
        assert.equal(await evaluate('[...document.querySelectorAll("input")].some(i => i.value === "Setup candidate")'), true)
        await button('Import PDF')
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".onboarding-drop")).borderStyle'), 'dashed')
        writeFileSync(resolve(__dirname, '../.cache/onboarding-pdf.png'), (await window.capturePage()).toPNG())
        const pdfPath = resolve(directory, 'setup-fixture.pdf')
        writeFileSync(pdfPath, pdfFixture({ text: 'Setup candidate Built the onboarding fixture.' }))
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pdfPath] })
        await button('Choose PDF')
        await wait(() => evaluate('document.body.innerText.includes("setup-fixture.pdf")'), 'selected PDF filename')
        assert.equal(requests, 0, 'selection alone does not parse')
        await button('Import')
        await wait(() => evaluate('!!document.querySelector("[data-import-id]")'), 'review PDF before confirmation')
        assert.equal((await data('profiles', 'listProfiles')).value.total, 1, 'unconfirmed import has not saved another profile')
        await button('Save imported content')
        await wait(() => evaluate('document.querySelector(".onboarding-step:not([hidden])").innerText.includes("Changes saved.")'), 'PDF saved')
        assert.equal(requests, 1)
        const importedProfile = (await data('profiles', 'listProfiles')).value.items[0]
        assert.equal((await data('profiles', 'getBaselineStatus', { profileId: importedProfile.id })).value.status, 'READY')
        await button('Continue'); await heading('Done'); await button('Open JAB')
        await wait(() => evaluate('!!document.querySelector(".app-shell")'), 'workspace opens')
        assert.equal((await data('settings', 'get')).value.onboardingCompleted, true)
        const saved = (await data('settings', 'get')).value.ai
        assert.equal(saved.default.modelId, 'fixture-b')
        assert.deepEqual(saved.providers.find(provider => provider.id === saved.default.providerId).models, ['fixture-a', 'fixture-b'])
        await evaluate("window.browser.navigate('app://settings')")
        await wait(() => evaluate('!!document.querySelector("[data-settings-general]")'), 'settings')
        await require('./open-section-cards.cjs')(evaluate, '[data-settings-general]')
        await require('./open-section-cards.cjs')(evaluate, '[data-ai-config]')
        await button('Add provider')
        await field('Endpoint', `http://127.0.0.1:${server.address().port}/v1`)
        await button('Continue')
        await wait(() => evaluate('document.querySelector(".ai-connection-results input[type=radio]")?.checked'), 'single model automatically selected')
        assert.deepEqual((await data('settings', 'get')).value.ai, saved)
        await evaluate('document.querySelector("[data-ai-connect]").click()')
        await wait(async () => (await data('settings', 'get')).value.ai.default.modelId === 'fixture-single', 'single model saved in Settings')
        assert.equal(requests, 1)
        await evaluate('document.querySelector("[data-settings-general] button[lang=zh-CN]").click()'); await frame()
        assert.equal(await evaluate('document.querySelector("[data-restart-onboarding]").disabled'), true, 'unsaved settings are preserved')
        dialog.showMessageBox = async () => ({ response: 1 })
        await evaluate("window.browser.navigate('app://ai')")
      }
      console.log(`Onboarding ${stage} smoke passed.`)
      server?.closeAllConnections(); server?.close()
      clearTimeout(timer); app.exit(0)
    } catch (error) {
      console.error(error)
      console.error(await evaluate('document.body.innerText'))
      clearTimeout(timer); server?.closeAllConnections(); server?.close(); app.exit(1)
    }
  })
})
require(resolve(__dirname, '../out/main/index.js'))
