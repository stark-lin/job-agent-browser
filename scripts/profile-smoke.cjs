const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { dialog } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
const { pdfFixture } = require('./profile-fixtures.cjs')

module.exports = async function profileSmoke({ window, call, read, active, evaluate, waitFor }) {
  const data = (method, input = {}) => evaluate(`window.data.profiles.${method}(${JSON.stringify(input)})`)
  const settings = input => evaluate(`window.data.settings.savePreferences(${JSON.stringify(input)})`)
  const original = (await evaluate('window.data.settings.get({})')).value
  const oldOpen = dialog.showOpenDialog, oldMessage = dialog.showMessageBox, oldSync = dialog.showMessageBoxSync
  const originalSize = window.getContentSize(), minimum = window.getMinimumSize()
  const frame = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const button = async (text, scope = 'document') => {
    await waitFor(() => evaluate(`!!${scope} && [...${scope}.querySelectorAll('button')].some(button => button.textContent === ${JSON.stringify(text)} && !button.disabled)`), `enabled profile button ${text}`)
    await evaluate(`[...${scope}.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(text)} && !button.disabled).click()`); await frame()
  }
  const field = async (label, text, scope = 'document') => {
    await evaluate(`(() => {
      const label = [...${scope}.querySelectorAll('.ui-field-label')].find(label => label.textContent === ${JSON.stringify(label)});
      const input = document.getElementById(label.htmlFor);
      const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`); await frame()
  }
  const section = title => `[...document.querySelectorAll('section')].find(section => section.querySelector(':scope > .ui-section-heading h2')?.textContent === ${JSON.stringify(title)})`
  const factCard = text => `[...document.querySelectorAll('dd')].find(dd => dd.textContent === ${JSON.stringify(text)}).closest('section')`
  const checkbox = async (label, scope = 'document') => {
    await evaluate(`[...${scope}.querySelectorAll('.ui-checkbox')].find(label => label.textContent === ${JSON.stringify(label)}).querySelector('input').click()`); await frame()
  }
  const body = { contact: { name: 'Imported candidate', email: 'imported@example.com', introduction: 'Imported introduction.\nOriginal wording.' }, links: [],
    items: [{ type: 'PROJECT', title: 'Imported project', degree: 'BSc', major: 'Computing', gpa: '3.8', employmentType: 'Contract', technologies: ['SQL'], url: 'https://example.com', startDateText: '2021', endDateText: '', isCurrent: true,
      facts: ['Built services', 'Improved latency'].map(content => ({ kind: 'ACHIEVEMENT', content })) }], facts: [] }
  let requests = 0
  const server = createServer((request, response) => {
    request.resume(); request.on('end', () => {
      requests++
      const chunk = (content, finish) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(chunk(JSON.stringify(body), 'stop') + 'data: [DONE]\n\n')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const path = resolve(process.env.JOB_BROWSER_SMOKE_DATA, 'profile-fixture.pdf')
  writeFileSync(path, pdfFixture({ text: 'Imported candidate Built services Improved latency' }))
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  try {
    await settings({ ai: { providers: [{ id: 'profile-fixture', name: 'Local profile fixture', baseURL: `http://127.0.0.1:${server.address().port}/v1`, requiresKey: false, models: ['fixture'], defaultModel: 'fixture' }], default: { providerId: 'profile-fixture', modelId: 'fixture' } }, language: 'en', theme: 'light' })
    await call('navigate', 'app://profile')
    await waitFor(() => evaluate('!!document.querySelector(".profile-page form") && document.body.innerText.includes("Local profile fixture")'), 'profile forms and provider disclosure')
    await button('Upload PDF and parse')
    await waitFor(() => evaluate('!!document.querySelector("[data-import-id]")'), 'first-profile import draft')
    window.setMinimumSize(320, 320); mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
    for (const width of [320, 1200]) {
      window.setContentSize(width, 820); await waitFor(() => evaluate(`innerWidth === ${width}`), 'import review viewport'); await frame()
      await evaluate(`${section('Imported project')}.scrollIntoView()`); await frame()
      assert.equal(await evaluate('document.querySelector(".profile-page").scrollWidth > document.querySelector(".profile-page").clientWidth'), false, `nested review overflow ${width}`)
      writeFileSync(resolve(__dirname, `../.cache/profile-review-${width}.png`), (await window.capturePage()).toPNG())
    }
    window.setContentSize(...originalSize)
    await field('Name', '')
    await field('URL', 'example.com', section('Imported project'))
    assert.equal(await evaluate('[...document.querySelectorAll("[data-import-id] [required]")].length'), 0)
    for (const [label, value] of [['Degree', 'BSc'], ['Major', 'Computing'], ['GPA', '3.8'], ['Employment type', 'Contract'], ['Technologies', 'SQL']]) {
      assert.equal(await evaluate(`(() => { const label = [...${section('Imported project')}.querySelectorAll('.ui-field-label')].find(label => label.textContent === ${JSON.stringify(label)}); return document.getElementById(label.htmlFor).value })()`), value)
    }
    await button('Save imported content')
    await waitFor(() => evaluate('document.activeElement?.value === "example.com" && document.activeElement.getAttribute("aria-invalid") === "true"'), 'invalid URL receives focus instead of empty name')
    assert.equal((await data('listProfiles')).value.total, 0)
    await field('URL', 'https://example.com', section('Imported project'))
    let draftRefreshPrompts = 0
    dialog.showMessageBoxSync = () => { draftRefreshPrompts++; return 0 }
    await window.webContents.executeJavaScript('document.querySelector(".profile-page input").focus()', true)
    window.webContents.reload(); await waitFor(() => Promise.resolve(draftRefreshPrompts === 1), 'cancelled refresh retains import session')
    assert.equal(await evaluate('document.querySelector("[data-import-id=contact-name] input").value'), '')
    dialog.showMessageBoxSync = oldSync
    await button('Save imported content')
    await waitFor(async () => (await data('listProfiles')).value.total === 1, 'first import creates profile atomically')
    const firstProfile = (await data('listProfiles')).value.items[0]
    assert.equal(firstProfile.introduction, body.contact.introduction)
    assert.equal(firstProfile.name, '', 'empty imported name saves without a required-field check')
    assert.equal((await data('listFacts', { profileId: firstProfile.id })).value.total, 2)
    await button('Discard import'); await button('Discard import', 'document.querySelector("dialog[open]")')
    await data('deleteProfile', { id: firstProfile.id }); await call('navigate', 'app://home'); await call('navigate', 'app://profile')
    await waitFor(() => evaluate('!!document.querySelector(".profile-page form input") && document.body.innerText.includes("Local profile fixture")'), 'manual creation after deleted context fallback')
    await field('Name', 'Manual candidate'); await field('Email', 'keep@example.com'); await field('Personal introduction', 'Manual introduction.\nSecond sentence.')
    await evaluate('document.querySelector(".profile-page form").requestSubmit()')
    let profile
    await waitFor(async () => { profile = (await data('listProfiles')).value.items.find(p => p.name === 'Manual candidate'); return Boolean(profile) }, 'created profile')
    assert.equal(profile.introduction, 'Manual introduction.\nSecond sentence.')
    await waitFor(() => evaluate(`[...(${section('Work experience')}?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'Add')?.disabled === false`), 'profile creation reflected')
    await button('Add', section('Work experience')); await field('Title', 'Manual experience', 'document.querySelector("dialog[open]")')
    await field('Start date', '2020', 'document.querySelector("dialog[open]")'); await field('End date', '2022-07', 'document.querySelector("dialog[open]")')
    await button('Save', 'document.querySelector("dialog[open]")')
    await waitFor(async () => (await data('listItems', { profileId: profile.id })).value.total === 1, 'manual experience saved')
    for (const content of ['Manual first', 'Manual second']) {
      await waitFor(() => evaluate('!document.querySelector("dialog[open]")'), 'editor closed')
      await button('Add fact', section('Manual experience')); await field('Fact', content, 'document.querySelector("dialog[open]")')
      await field('Tags (comma separated)', 'SQL, ', 'document.querySelector("dialog[open]")')
      assert.equal(await evaluate(`(() => { const label = [...document.querySelectorAll('dialog[open] .ui-field-label')].find(label => label.textContent === 'Tags (comma separated)'); return document.getElementById(label.htmlFor).value })()`), 'SQL, ')
      await field('Tags (comma separated)', 'SQL, TypeScript', 'document.querySelector("dialog[open]")')
      await button('Save', 'document.querySelector("dialog[open]")')
      await waitFor(() => evaluate('!document.querySelector("dialog[open]")'), 'fact saved')
    }
    let facts = (await data('listFacts', { profileId: profile.id })).value.items
    assert.equal(facts.length, 2); assert(facts.every(fact => fact.profileItemId))
    assert.deepEqual(facts[0].tags, ['SQL', 'TypeScript'])
    await button('Edit', factCard('Manual first')); await field('Fact', 'Manual first edited', 'document.querySelector("dialog[open]")'); await button('Save', 'document.querySelector("dialog[open]")')
    await waitFor(() => evaluate('!document.querySelector("dialog[open]")'), 'fact edit saved')
    facts = (await data('listFacts', { profileId: profile.id })).value.items
    assert(facts.some(fact => fact.content === 'Manual first edited'))
    assert(facts.every(fact => !('verificationStatus' in fact)))
    await button('Upload PDF and parse')
    await waitFor(() => evaluate('!!document.querySelector("[data-import-id]")'), 'built PDF worker and SSE parsed draft')
    await checkbox('Ignore', '[...document.querySelectorAll("[data-import-id=contact-name] .ui-checkbox")][0].parentElement')
    const importedFact = text => `[...document.querySelectorAll('textarea')].find(input => input.value === ${JSON.stringify(text)}).closest('section')`
    await checkbox('Ignore', importedFact('Improved latency'))
    await field('Fact', 'Reviewed first', importedFact('Built services'))
    await button('Save imported content')
    await waitFor(async () => (await data('listFacts', { profileId: profile.id })).value.total === 3, 'first import subset saved')
    await waitFor(() => evaluate('document.body.innerText.includes("Entry already saved")'), 'saved parent retained for remaining facts')
    const contact = (await data('getProfile', { id: profile.id })).value
    assert.equal(contact.name, 'Manual candidate'); assert.equal(contact.email, 'imported@example.com')
    await checkbox('Ignore', importedFact('Improved latency')); await button('Save imported content')
    await waitFor(async () => (await data('listFacts', { profileId: profile.id })).value.total === 4, 'remaining fact saved')
    const items = (await data('listItems', { profileId: profile.id })).value.items
    assert.equal(items.length, 2)
    const imported = items.find(item => item.title === 'Imported project')
    assert.equal(imported.startDate, null); assert.equal(imported.metadata.startDateText, '2021')
    facts = (await data('listFacts', { profileId: profile.id })).value.items
    assert.equal(facts.filter(fact => fact.profileItemId === imported.id).length, 2)
    assert(facts.filter(fact => fact.profileItemId === imported.id).every(fact => fact.evidence === ''))
    await button('Discard import'); await button('Discard import', 'document.querySelector("dialog[open]")')
    await waitFor(() => evaluate('!document.querySelector("dialog[open]") && document.body.innerText.includes("Upload PDF and parse")'), 'import draft discarded')
    // A second upload deliberately permits the same material to be added again.
    await button('Upload PDF and parse'); await waitFor(() => evaluate('!!document.querySelector("[data-import-id]")'), 'second upload parsed')
    await button('Save imported content'); await waitFor(async () => (await data('listItems', { profileId: profile.id })).value.total === 3, 'duplicate upload adds a new entry')
    await button('Discard import'); await button('Discard import', 'document.querySelector("dialog[open]")')
    await waitFor(() => evaluate('!document.querySelector("dialog[open]")'), 'second draft discarded')
    assert.equal(requests, 3)
    const duplicateSection = `[...document.querySelectorAll('section')].filter(section => section.querySelector(':scope > .ui-section-heading h2')?.textContent === 'Imported project').at(-1)`
    await button('Delete', duplicateSection)
    assert(await evaluate('document.querySelector("dialog[open]").innerText.includes("0 descendant entries and 2 attached facts")'))
    await button('Delete', 'document.querySelector("dialog[open]")')
    await waitFor(async () => (await data('listItems', { profileId: profile.id })).value.total === 2, 'entry deleted through impact dialog')
    // Renderer reload exercises current-profile fallback and complete pagination.
    for (let index = 0; index < 101; index++) await data('addFact', { profileId: profile.id, details: { kind: 'SKILL', content: `Pagination ${index}` } })
    const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve)); window.webContents.reload(); await loaded
    await waitFor(() => evaluate('document.body.innerText.includes("Pagination 100")'), 'all fact pages restored after reload')
    assert.equal(await evaluate('document.querySelector(".profile-page form textarea").value'), body.contact.introduction)
    await button('Delete', factCard('Pagination 0')); await button('Delete', 'document.querySelector("dialog[open]")')
    await waitFor(async () => (await data('listFacts', { profileId: profile.id })).value.total === 104, 'individual fact deletion')
    window.setMinimumSize(320, 320)
    mkdirSync(resolve(__dirname, '../.cache'), { recursive: true })
    for (const language of ['en', 'zh-CN']) for (const theme of ['light', 'dark']) {
      await settings({ language, theme }); await waitFor(() => evaluate(`document.documentElement.lang === ${JSON.stringify(language)} && document.documentElement.dataset.theme === ${JSON.stringify(theme)}`), 'profile locale and theme')
      for (const width of [320, 640, 1200]) {
        window.setContentSize(width, 820); await waitFor(() => evaluate(`innerWidth === ${width}`), 'profile responsive viewport'); await frame()
        assert.equal(await evaluate('document.querySelector(".profile-page").scrollWidth > document.querySelector(".profile-page").clientWidth'), false, `profile overflow ${language}/${theme}/${width}`)
        assert.equal(await evaluate('[...document.querySelectorAll(".profile-page input:not([type=checkbox]), .profile-page textarea, .profile-page select")].every(input => document.querySelector(`label[for="${input.id}"]`))'), true)
        if (language === 'zh-CN') {
          writeFileSync(resolve(__dirname, `../.cache/profile-${theme}-${width}.png`), (await window.capturePage()).toPNG())
          await evaluate('document.querySelector(".profile-page form textarea").scrollIntoView({block:"center"})'); await frame()
          writeFileSync(resolve(__dirname, `../.cache/profile-introduction-${theme}-${width}.png`), (await window.capturePage()).toPNG())
          await evaluate('document.querySelector(".profile-page h1").scrollIntoView()'); await frame()
        }
      }
    }
    await settings({ language: 'en' }); await frame()
    const profileTabId = active(await read()).id
    await call('navigate', 'app://home'); await call('back')
    await call('createTab'); const otherTabId = active(await read()).id
    await call('activateTab', profileTabId)
    await waitFor(() => evaluate('!!document.querySelector(".profile-page form input")'), 'profile restored for leave guards')
    await field('Personal introduction', 'Unsaved introduction')
    let prompts = 0
    dialog.showMessageBox = async () => { prompts++; return { response: 0, checkboxChecked: false } }
    await call('navigate', 'app://home')
    assert.equal(active(await read()).destination.page, 'profile'); assert.equal(prompts, 1)
    const beforeTabs = (await read()).tabs.length
    await call('createTab'); assert.equal((await read()).tabs.length, beforeTabs)
    window.close(); await waitFor(() => Promise.resolve(prompts === 3), 'profile window-close guard'); assert(!window.isDestroyed())
    for (const [method, argument] of [['closeTab', profileTabId], ['activateTab', otherTabId], ['back'], ['forward']]) {
      const before = prompts; await call(method, ...(argument ? [argument] : []))
      assert.equal(prompts, before + 1, `${method} checks unsaved profile`); assert.equal(active(await read()).destination.page, 'profile')
    }
    let refreshPrompts = 0
    dialog.showMessageBoxSync = () => { refreshPrompts++; return 0 }
    await window.webContents.executeJavaScript('document.querySelector(".profile-page form input").focus()', true)
    window.webContents.reload(); await waitFor(() => Promise.resolve(refreshPrompts === 1), 'profile refresh cancellation')
    assert.equal(await evaluate('document.querySelector(".profile-page form textarea").value'), 'Unsaved introduction')
    dialog.showMessageBoxSync = () => 1
    const refreshed = new Promise(resolve => window.webContents.once('did-finish-load', resolve)); window.webContents.reload(); await refreshed
    await waitFor(() => evaluate('document.querySelector(".profile-page form input")?.value === "Imported candidate"'), 'saved profile restored after discarded edit')
    assert.equal(await evaluate('document.querySelector(".profile-page form input").value'), 'Imported candidate')
    await call('closeTab', otherTabId)
    console.log('Profile smoke passed: manual CRUD, multiple facts, real PDF Worker/SSE, explicit saves and ignored content, partial saves, duplicate upload, pagination/reload, bilingual themes/responsive layout and leave/window guards.')
  } finally {
    dialog.showOpenDialog = oldOpen; dialog.showMessageBox = oldMessage; dialog.showMessageBoxSync = oldSync
    window.setMinimumSize(...minimum); window.setContentSize(...originalSize)
    await settings({ ai: original.ai, language: original.language, theme: original.theme })
    await call('navigate', 'app://home')
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  }
}
