const { app, utilityProcess } = require('electron')
const fork = utilityProcess.fork
utilityProcess.fork = function (...args) {
  const child = fork.apply(this, args)
  child.stderr?.on('data', data => process.stderr.write(data))
  child.on('exit', code => console.log('Model fixture process exit', code))
  return child
}
const assert = require('node:assert/strict')
const { join } = require('node:path')
const { createReadStream, readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { Readable } = require('node:stream')
const root = process.env.JAB_MODEL_SMOKE_APP, seed = process.env.JAB_MODEL_SMOKE_SEED, data = process.env.JOB_BROWSER_SMOKE_DATA
assert(root && seed && data)
const agentHome = join(data, 'agent-home'); mkdirSync(agentHome, {recursive:true})
app.setPath('home', agentHome); process.env.CODEX_HOME = join(agentHome, '.codex')
app.setPath('userData', data)
app.setAppPath(root)
const manifest = JSON.parse(readFileSync(join(root, 'resources/embedding-model.json')))
const requests = []
let mode = 'offline', blocked = false
// Host-only fixture transport: actual manifest sizes/checksums and production IPC/installer.
// No model-manager/test capability is shipped in the application.
globalThis.fetch = async (url, options) => {
  const prefix = `https://huggingface.co/${manifest.source}/resolve/${manifest.revision}/`
  assert(String(url).startsWith(prefix), 'Unexpected network request in model fixture')
  const path = String(url).slice(prefix.length)
  assert(manifest.files.some(file => file.path === path))
  requests.push(path)
  if (mode === 'offline') throw new Error('Offline fixture')
  if (mode === 'cancel' && path.endsWith('.onnx')) {
    blocked = true
    await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('Cancelled fixture')), { once: true }))
  }
  return new Response(Readable.toWeb(createReadStream(join(seed, path))))
}
const deadline = setTimeout(() => { console.error('Model runtime timed out'); app.exit(1) }, 170000)
let selected = false
app.on('browser-window-created', (_event, window) => {
  if (selected) return
  selected = true
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    const evaluate = code => window.webContents.executeJavaScript(code)
    const call = (method, input = {}) => evaluate(`window.knowledge.${method}(${JSON.stringify(input)})`)
    const wait = async (check, label) => {
      const end = Date.now() + 45000
      while (!await check()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await new Promise(resolve => setTimeout(resolve, 30)) }
    }
    const state = async value => (await call('modelStatus')).value.state === value
    const click = async label => {
      const selector = `[...document.querySelectorAll('[data-local-model] > .settings-actions button')].find(b=>b.textContent===${JSON.stringify(label)}&&!b.disabled)`
      await wait(() => evaluate(`!!(${selector})`), 'available action ' + label)
      await evaluate(`(${selector}).click()`)
    }
    try {
      console.log('Model fixture: renderer loaded')
      await wait(() => state('missing'), 'missing model')
      assert((await call('write', { path: 'model-smoke.md', content: '# Work\nTrip.com offers relatively flexible working conditions.', expectedRevision: null })).ok)
      const keyword = await call('search', { query: 'Trip.com' }); assert(keyword.ok && !keyword.value.semantic)
      await evaluate("window.browser.navigate('app://settings')")
      await wait(() => evaluate('!!document.querySelector("[data-local-model]")'), 'model controls')
      console.log('Model fixture: missing-model keyword retrieval ready')
      await click('Download Model'); await wait(() => state('error'), 'offline failure')
      assert((await call('search', { query: 'Trip.com' })).ok, 'Offline model failure must preserve notes')
      console.log('Model fixture: offline failure handled')
      mode = 'cancel'; await click('Repair Model')
      await wait(() => blocked, 'weight transfer')
      await click('Cancel'); await wait(() => state('error'), 'cancel settled')
      console.log('Model fixture: cancellation settled')
      const configsBefore = requests.filter(path => path === 'config.json').length
      mode = 'download'; await click('Repair Model'); await wait(() => state('ready'), 'verified model ready')
      assert.equal(requests.filter(path => path === 'config.json').length, configsBefore, 'Retry must reuse verified files')
      console.log('Model fixture: verified installation ready')
      await wait(async () => { const r = await call('search', { query: '哪家公司工作环境相对灵活？' }); return r.ok && r.value.semantic && r.value.items[0]?.path === 'model-smoke.md' }, 'immediate embedding indexing')
      await wait(() => evaluate('!document.querySelector("[data-local-model]").parentElement.textContent.includes("Semantic search is currently unavailable")'), 'semantic feedback refreshed')
      console.log('Model fixture: semantic indexing refreshed')
      // Exercise the real central controls in both themes/languages and narrow layouts.
      window.setMinimumSize(320, 320)
      for (const language of ['en', 'zh-CN']) for (const theme of ['light', 'dark']) {
        const saved = await evaluate(`window.data.settings.savePreferences(${JSON.stringify({ language, theme })})`)
        assert(saved.ok)
        await wait(() => evaluate(`document.documentElement.lang==='${language}'&&document.documentElement.dataset.theme==='${theme}'`), 'theme/language')
        for (const width of [320, 640, 1200]) {
          window.setContentSize(width, 900)
          await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
          assert(!await evaluate('document.querySelector(".settings-page").scrollWidth>document.querySelector(".settings-page").clientWidth'), `model settings overflow ${language}/${theme}/${width}`)
        }
      }
      assert((await evaluate("window.data.settings.savePreferences({language:'en',theme:'light'})")).ok)
      await wait(() => evaluate("document.documentElement.lang==='en'"), 'restore language')
      if (process.env.JAB_MODEL_SMOKE_CAPTURE) {
        await evaluate('document.querySelector("[data-local-model]").scrollIntoView()')
        writeFileSync(process.env.JAB_MODEL_SMOKE_CAPTURE, (await window.webContents.capturePage()).toPNG())
      }
      await click('Remove Model')
      await wait(() => evaluate('!!document.querySelector("dialog[open]")'), 'remove confirmation')
      assert(await evaluate('document.activeElement.textContent.includes("Cancel")'), 'Cancel initially focused')
      await evaluate('[...document.querySelector("dialog[open]").querySelectorAll("button")].find(b=>b.textContent==="Remove Model").click()')
      await wait(() => state('missing'), 'model removed')
      const fallback = await call('search', { query: 'Trip.com' }); assert(fallback.ok && !fallback.value.semantic && fallback.value.items.length)
      assert((await call('read', { path: 'model-smoke.md' })).ok)
      const prefs = JSON.parse(readFileSync(join(process.env.JAB_MODEL_STORE, 'seed-preferences.json')))
      assert.equal(prefs.autoImportSeed, false)
      if (process.env.JAB_MODEL_SMOKE_KEEP === '1') {
        assert((await call('modelInstall', { source: 'download' })).ok)
        assert(await state('ready'))
      }
      console.log('Model GUI lifecycle verified: missing/offline/cancel/reuse/install, immediate cross-language indexing, bilingual responsive controls, confirmed removal and keyword fallback.')
      clearTimeout(deadline); app.quit()
    } catch (error) { console.error(error); console.error('Model diagnostics', await call('modelStatus'), await call('configuration'), await call('search', {query:'Trip.com'})); app.exit(1) }
  })
})
require(join(root, 'out/main/index.js'))
