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
        await button('Continue'); await heading('AI Connection')
        const connection = '[data-ai-connection]', advanced = '[data-ai-advanced]'
        const fieldOrder = (scope, extra = '') => evaluate(`[...document.querySelectorAll(${JSON.stringify(scope + ' label' + extra)})].filter(l => l.checkVisibility()).map(l => l.textContent)`)
        const toggleAdvanced = () => evaluate(`document.querySelector('${advanced} > summary').click()`)
        const placeholders = () => evaluate(`[...document.querySelectorAll('${advanced} input[type=number]')].map(input => input.placeholder)`)
        const basicFields = ['Endpoint', 'API Key', 'Model']
        const advancedFields = ['Connection Name', 'Provider Preset', 'Authentication', 'Manual Model ID', 'Model List',
          'Context Window', 'Max Output Tokens', 'AI Request Timeout', 'Model Discovery Timeout', 'Page Fetch Timeout']
        assert.deepEqual(await fieldOrder(connection), basicFields)
        await toggleAdvanced()
        assert.deepEqual(await fieldOrder(advanced), advancedFields)
        const defaults = await placeholders()
        assert.deepEqual(defaults, ['Auto (65,536 fallback)', 'Auto (8,192 fallback)', '300 seconds', '15 seconds', '20 seconds'])
        await toggleAdvanced()
        let requests = 0, discoveries = 0, available = false
        const discoveredWith = []
        server = createServer((request, response) => {
          if (request.url === '/v1/models') {
            discoveries++
            discoveredWith.push(request.headers.authorization)
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ data: available ? [{ id: 'fixture-a' }, { id: 'fixture-b' }] : [] }))
            return
          }
          request.resume(); request.on('end', () => {
            requests++
            response.writeHead(200, { 'Content-Type': 'text/event-stream' })
            response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ contact: { name: 'Setup candidate', introduction: 'Built the onboarding fixture.' }, links: [], items: [], facts: [], unmapped: [] }) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
          })
        })
        await new Promise(r => server.listen(0, '127.0.0.1', r))
        const endpoint = `http://127.0.0.1:${server.address().port}/v1`
        const originalAI = (await data('settings', 'get')).value.ai
        await field('Endpoint', endpoint)
        await field('API Key', 'draft-fixture-key')
        await button('Continue')
        await wait(() => evaluate('document.body.innerText.includes("valid, non-empty model list")'), 'empty list rejected')
        assert.deepEqual((await data('settings', 'get')).value.ai, originalAI)
        assert.equal((await data('secrets', 'hasProviderKey', { provider: originalAI.providers[0].id })).value.configured, false)
        await field('API Key', '')
        available = true
        await button('Continue')
        await wait(() => evaluate('document.body.innerText.includes("Choose a model to continue.")'), 'choose one of multiple models')
        assert.deepEqual((await data('settings', 'get')).value.ai, originalAI)
        await field('Model', 'fixture-a')
        await toggleAdvanced()
        await field('Manual Model ID', 'manual-fixture'); await button('Add model')
        await field('Context Window', '32768')
        await field('AI Request Timeout', '42')
        await button('Continue'); await heading('Agent')
        const configured = (await data('settings', 'get')).value.ai
        assert.equal(discoveries, 2)
        assert.deepEqual(discoveredWith, ['Bearer draft-fixture-key', undefined])
        assert.equal(requests, 0, 'connection only calls /models')
        assert.equal(configured.default.modelId, 'fixture-a')
        assert(configured.providers[0].models.includes('manual-fixture'))
        assert.deepEqual(configured.providers[0].overrides, { 'fixture-a': { contextWindow: 32768 } })
        assert.deepEqual(configured.timeoutOverrides, { requestSeconds: 42 })
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
        assert.equal((await data('settings', 'get')).value.ai.default.modelId, 'fixture-a')
        await evaluate("window.browser.navigate('app://settings')")
        await wait(() => evaluate('!!document.querySelector("[data-settings-general]")'), 'settings')
        await require('./open-section-cards.cjs')(evaluate, '[data-settings-general], [data-ai-connection]')
        for (const width of [320, 640, 1200]) {
          window.setContentSize(width, 820)
          await wait(() => evaluate(`innerWidth === ${width}`), 'settings viewport')
          await frame()
          assert.deepEqual(await evaluate(`(() => {
            const scope = document.querySelector('.settings-ai-layout')
            const actions = scope.querySelector('.settings-stack > .ui-action-row')
            const box = element => element.getBoundingClientRect()
            return [box(actions).top - box(scope.querySelector('select')).bottom,
              box(scope.querySelector('[data-ai-connection]')).top - box(actions).bottom,
              scope.scrollWidth > scope.clientWidth]
          })()`), [16, 24, false])
        }
        assert.deepEqual(await fieldOrder(connection), basicFields)
        await toggleAdvanced()
        assert.deepEqual(await fieldOrder(advanced), advancedFields)
        assert.deepEqual(await placeholders(), defaults)
        await button('Restore Defaults'); await button('Save changes')
        await wait(async () => (await data('settings', 'get')).value.ai.timeoutOverrides === undefined, 'restore saved defaults')
        const restored = (await data('settings', 'get')).value.ai
        assert.equal(restored.providers[0].overrides, undefined)
        assert.equal(restored.default.modelId, 'fixture-a')
        assert.equal(discoveries, 2, 'advanced-only save skips discovery')
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
