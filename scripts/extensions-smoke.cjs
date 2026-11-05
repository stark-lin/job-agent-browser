const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { generateKeyPairSync, randomUUID } = require('node:crypto')
const { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

if (process.versions.electron) child()
else {
  const directory = mkdtempSync(join(tmpdir(), 'jab-extension-smoke-'))
  const env = { ...process.env, JOB_BROWSER_USER_DATA: directory, JAB_MODEL_STORE: join(directory, 'models') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const launch = phase => {
    const result = spawnSync(require('electron'), [__filename, phase], { env, stdio: 'inherit', timeout: 45000 })
    if (result.error) throw result.error
    assert.equal(result.status, 0, `Extension smoke phase ${phase} failed (${result.signal ?? 'exit'})`)
  }
  try {
    launch('install')
    const { targetRuntime, survivorRuntime } = read(directory, 'extension-smoke-state.json')
    const partition = join(directory, 'Partitions', 'job-agent-browser')
    const storage = join(partition, 'Local Extension Settings', targetRuntime)
    const backup = join(directory, 'extension-storage-backup')
    renameSync(storage, backup)
    symlinkSync(backup, storage, 'junction')
    launch('failed-cleanup')
    unlinkSync(storage)
    renameSync(backup, storage)
    // The pinned Electron build does not expose storage.sync. Verify the offline
    // cleanup also scopes any on-disk Sync Extension Settings to the target ID.
    for (const id of [targetRuntime, survivorRuntime]) {
      const sync = join(partition, 'Sync Extension Settings', id)
      mkdirSync(sync, { recursive: true })
      writeFileSync(join(sync, 'fixture'), 'sentinel')
    }
    launch('cleanup')
  } finally { rmSync(directory, { force: true, recursive: true }) }
}

function read(directory, file) { return JSON.parse(readFileSync(join(directory, file), 'utf8')) }

function makeExtension(directory, name, marker, options) {
  const path = join(directory, `unpacked-${marker}`)
  mkdirSync(path)
  const key = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const manifest = { name, version: '1.2', manifest_version: 3, permissions: ['storage'], ...options,
    ...(marker === 'target' ? { key } : {}), background: { service_worker: 'worker.js' },
    content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }] }
  for (const [file, contents] of Object.entries({
    'manifest.json': JSON.stringify(manifest),
    'worker.js': "chrome.storage.local.set({worker: 'started'})",
    'content.js': `document.documentElement.dataset.${marker} = 'injected'`,
    'options.html': '<title>Fixture options</title><a href="nested.html">Nested options</a>',
    'nested.html': '<title>Nested options</title>'
  })) writeFileSync(join(path, file), contents)
  return path
}

function child() {
  const { app, BrowserWindow, dialog, session } = require('electron')
  const { createServer } = require('node:http')
  const { Client } = require('@modelcontextprotocol/client')
  const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio')
  const phase = process.argv[2], directory = process.env.JOB_BROWSER_USER_DATA
  const filename = 'extension-smoke-state.json'
  const index = () => read(directory, 'extensions/index.json').extensions
  const webViews = require('./native-views.cjs').views
  require('./external-mcp-test-home.cjs')(directory)
  const timeout = setTimeout(() => { console.error(`Extension smoke timed out: ${phase}`); app.exit(1) }, 40000)
  let client, server
  const pause = () => new Promise(resolve => setTimeout(resolve, 25))
  async function waitFor(check, description) {
    for (let i = 0; i < 200; i++) {
      const result = await check()
      if (result) return result
      await pause()
    }
    throw Error(`Timed out waiting for ${description}`)
  }

  app.once('browser-window-created', (_event, window) => {
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
      try {
        const evaluate = source => window.webContents.executeJavaScript(source)
        const browser = (method, ...args) => evaluate(`window.browser[${JSON.stringify(method)}](...${JSON.stringify(args)})`)
        const ui = async (method, ...args) => {
          const reply = await evaluate(`window.browserExtensions[${JSON.stringify(method)}](...${JSON.stringify(args)})`)
          assert(reply.ok, JSON.stringify(reply))
          return reply.value
        }
        const status = async (id, expected) => waitFor(async () => (await ui('list')).some(row => row.id === id && row.status === expected), expected)
        const visibleRow = (id, detail = '') => evaluate(`Boolean(document.querySelector(${JSON.stringify(`[data-extension="${id}"]${detail}`)}))`)
        const click = async selector => {
          await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), selector)
          await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
        }
        const siteView = url => waitFor(() => webViews(window).find(view => view.webContents.getURL() === url && !view.webContents.isLoadingMainFrame()), url)
        const stored = async view => view.webContents.executeJavaScript("Promise.all([chrome.storage.local.get('sentinel').then(x => x.sentinel ?? null), localStorage.getItem('sentinel')])")
        const keepData = async view => {
          await waitFor(() => view.webContents.executeJavaScript("chrome.storage.local.get('worker').then(x => x.worker === 'started')"), 'extension service worker')
          await view.webContents.executeJavaScript("localStorage.setItem('sentinel','keep'); chrome.storage.local.set({sentinel:'keep'})")
        }
        const openOptions = async (id, runtime) => {
          await ui('openOptions', id)
          return siteView(`chrome-extension://${runtime}/options.html`)
        }
        async function mcp(method, args) {
          if (!client) {
            client = new Client({ name: 'extensions-electron-smoke', version: '1' })
            await client.connect(new StdioClientTransport({ command: process.execPath,
              args: [resolve(__dirname, '../out/main/job-agent-mcp.js')],
              env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stderr: 'inherit' }))
          }
          const result = await client.callTool({ name: `browser.extension.${method}`, arguments: args })
          assert(!result.isError, JSON.stringify(result))
          return result.structuredContent
        }

        const webSession = session.fromPartition('persist:job-agent-browser')
        assert.equal(webSession.storagePath, join(directory, 'Partitions', 'job-agent-browser'))
        const prior = phase === 'install' ? null : read(directory, filename)
        server = createServer((_request, response) => response.end('<title>Extension fixture website</title>'))
        await new Promise((done, reject) => {
          server.once('error', reject)
          server.listen(prior?.port ?? 0, '127.0.0.1', done)
        })
        const port = server.address().port, site = `http://127.0.0.1:${port}`
        await browser('navigate', 'app://settings')
        await waitFor(() => evaluate('!!document.querySelector("[data-extension-import]:enabled")'), 'Settings extension section')

        if (phase === 'install') {
          const targetPath = makeExtension(directory, 'Target extension', 'target', { options_ui: { page: 'options.html' } })
          const survivorPath = makeExtension(directory, 'Surviving extension', 'survivor', { options_page: 'options.html' })
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [targetPath] })
          let response = 0
          dialog.showMessageBox = async (_window, options) => {
            assert.match(options.detail, /storage/)
            assert.match(options.detail, /Inbox/)
            return { response }
          }
          await ui('importDirectory')
          assert.deepEqual(await ui('list'), [], 'Cancel creates no install record')
          response = 1
          await ui('importDirectory')
          const [target] = index()
          assert.equal(target.source, 'manual')
          await status(target.id, 'RUNNING')
          await waitFor(() => visibleRow(target.id, ' [data-extension-options]'), 'manual row')

          const requestId = randomUUID()
          const result = await mcp('install', { path: survivorPath, requestId })
          assert.equal(result.status, 'INSTALLED_DISABLED')
          const survivorId = result.extensionId
          await waitFor(() => visibleRow(survivorId, ' [role=switch][aria-checked=false]'), 'MCP index change in Settings')
          assert.equal(webSession.extensions.getExtension(index().find(row => row.id === survivorId).identity), null)
          const asset = join(directory, 'extensions/packages', survivorId, 'nested.html')
          const content = readFileSync(asset)
          unlinkSync(asset)
          await click(`[data-extension="${survivorId}"] [role=switch]`)
          await status(survivorId, 'FAILED')
          writeFileSync(asset, content)
          await ui('setEnabled', survivorId, true)
          await status(survivorId, 'RUNNING')
          const { runtimeId: survivorRuntime } = index().find(row => row.id === survivorId)
          const targetRuntime = target.runtimeId
          assert.notEqual(targetRuntime, survivorRuntime)

          await webSession.cookies.set({ url: site, name: 'fixture-login', value: 'preserved', expirationDate: Date.now() / 1000 + 600 })
          await browser('navigate', `${site}/browser`)
          const regular = await siteView(`${site}/browser`)
          await regular.webContents.executeJavaScript("localStorage.setItem('fixture-web-storage','preserved')")
          assert.deepEqual(await regular.webContents.executeJavaScript('[document.documentElement.dataset.target, document.documentElement.dataset.survivor]'), ['injected', 'injected'])
          const extensionURL = `chrome-extension://${targetRuntime}/options.html`
          await assert.rejects(browser('navigate', extensionURL))
          await regular.webContents.executeJavaScript(`location.href = ${JSON.stringify(extensionURL)}; void 0`)
          assert.equal(regular.webContents.getURL(), `${site}/browser`)

          webSession.webRequest.onBeforeRequest({ urls: ['https://mail.fixture.invalid/*'] }, (_details, callback) => callback({ redirectURL: `${site}/inbox` }))
          const settings = await evaluate("window.data.settings.savePreferences({mailbox:{provider:'custom',url:'https://mail.fixture.invalid/inbox'}})")
          assert(settings.ok)
          await browser('navigate', 'app://inbox')
          const inbox = await siteView(`${site}/inbox`)
          assert.deepEqual(await inbox.webContents.executeJavaScript('[document.documentElement.dataset.target, document.documentElement.dataset.survivor]'), ['injected', 'injected'])
          assert.equal(await inbox.webContents.executeJavaScript('typeof window.browserExtensions'), 'undefined')
          assert.equal(session.defaultSession.extensions.getExtension(targetRuntime), null)
          const outsider = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, partition: 'resume-extension-smoke' } })
          await outsider.loadURL(`${site}/outside`)
          assert.equal(await outsider.webContents.executeJavaScript('document.documentElement.dataset.target ?? null'), null)
          await assert.rejects(outsider.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('browser-extensions:call','list')"), /Untrusted IPC sender/)
          outsider.destroy()

          await browser('navigate', 'app://settings')
          const settingsId = (await browser('getState')).activeTabId
          await click(`[data-extension="${target.id}"] [data-extension-options]`)
          const options = await siteView(extensionURL)
          await keepData(options)
          assert.equal(await options.webContents.executeJavaScript('typeof window.browserExtensions'), 'undefined')
          await options.webContents.executeJavaScript("document.querySelector('a').click()")
          await siteView(`chrome-extension://${targetRuntime}/nested.html`)
          await options.webContents.executeJavaScript(`location.href = ${JSON.stringify(site)}; void 0`)
          assert.equal(options.webContents.getURL(), `chrome-extension://${targetRuntime}/nested.html`)
          assert.equal((await browser('getState')).tabs.find(tab => tab.id === settingsId).destination.page, 'settings')
          await browser('activateTab', settingsId)
          await waitFor(() => visibleRow(target.id, ' [data-extension-delete]'), 'original Settings tab')
          await ui('setEnabled', target.id, false)
          await status(target.id, 'DISABLED')
          assert.equal(webSession.extensions.getExtension(targetRuntime), null)
          assert(!webViews(window).some(view => view.webContents.getURL().startsWith(`chrome-extension://${targetRuntime}`)))
          await ui('setEnabled', target.id, true)
          const reopened = await openOptions(target.id, targetRuntime)
          assert.deepEqual(await stored(reopened), ['keep', 'keep'])
          await browser('activateTab', settingsId)
          await keepData(await openOptions(survivorId, survivorRuntime))
          await browser('activateTab', settingsId)

          await waitFor(() => visibleRow(target.id, ' [data-extension-delete]:enabled'), 'target delete button')
          await click(`[data-extension="${target.id}"] [data-extension-delete]`)
          assert.equal((await browser('getState')).activeTabId, settingsId)
          await waitFor(() => evaluate('!!document.querySelector("dialog[open] [data-extension-confirm-delete]")'), 'delete confirmation')
          await click('dialog[open] [data-extension-confirm-delete]')
          await status(target.id, 'PENDING_REMOVAL')
          assert.equal(webSession.extensions.getExtension(targetRuntime), null)
          assert(webSession.extensions.getExtension(survivorRuntime))
          assert(existsSync(join(directory, 'extensions/packages', target.id, 'manifest.json')))
          assert.equal((await mcp('list', {})).extensions.find(row => row.id === target.id).pendingRemoval, true)
          writeFileSync(join(directory, filename), JSON.stringify({ port, target: target.id, survivor: survivorId, targetPath, targetRuntime, survivorRuntime }))
        } else {
          const { target, survivor, targetPath, targetRuntime, survivorRuntime } = prior
          assert.equal(webSession.extensions.getExtension(targetRuntime), null)
          assert.equal((await webSession.cookies.get({ name: 'fixture-login' }))[0]?.value, 'preserved')
          await status(survivor, 'RUNNING')
          await browser('navigate', `${site}/browser`)
          const regular = await siteView(`${site}/browser`)
          assert.deepEqual(await regular.webContents.executeJavaScript(
            "[document.documentElement.dataset.target ?? null, document.documentElement.dataset.survivor, localStorage.getItem('fixture-web-storage')]"),
            [null, 'injected', 'preserved'])
          await browser('navigate', 'app://settings')
          assert.deepEqual(await stored(await openOptions(survivor, survivorRuntime)), ['keep', 'keep'])
          assert(existsSync(join(targetPath, 'manifest.json')), 'original import folder preserved')
          if (phase === 'failed-cleanup') {
            assert((await ui('list')).some(row => row.id === target && row.status === 'PENDING_REMOVAL' && row.cleanupFailed))
            assert.deepEqual(await mcp('install', { path: targetPath, requestId: randomUUID() }), { status: 'PENDING_REMOVAL' })
          } else {
            assert(!(await ui('list')).some(row => row.id === target))
            assert(!existsSync(join(directory, 'extensions/packages', target)))
            const sync = join(webSession.storagePath, 'Sync Extension Settings')
            assert(!existsSync(join(sync, targetRuntime)))
            assert(existsSync(join(sync, survivorRuntime, 'fixture')))
            const { extensionId } = await mcp('install', { path: targetPath, requestId: randomUUID() })
            await ui('setEnabled', extensionId, true)
            assert.deepEqual(await stored(await openOptions(extensionId, targetRuntime)), [null, null])
          }
        }
        console.log(`Browser extensions smoke passed (${phase})`)
        await client?.close()
        server.closeAllConnections()
        await new Promise(done => server.close(done))
        clearTimeout(timeout)
        app.quit()
      } catch (error) {
        clearTimeout(timeout)
        console.error(error)
        await client?.close().catch(() => {})
        app.exit(1)
      }
    })
  })
  require(resolve(__dirname, '../out/main/index.js'))
}
