const assert = require('node:assert/strict')
const { clipboard } = require('electron')
const { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } = require('node:fs')
const { dirname, resolve } = require('node:path')

module.exports = async function externalMCPSmoke({ window, evaluate, waitFor, data, capture }) {
  const api = (method, input) => evaluate(`window.externalMCP.${method}(${JSON.stringify(input)})`)
  const selector = target => `[data-agent-target="${target}"]`
  const click = (target, action) => evaluate(`document.querySelector('${selector(target)} [data-mcp-${action}]').click()`)
  const ready = () => waitFor(() => evaluate('document.querySelectorAll("[data-agent-target]").length === 4 && !document.querySelector("[data-mcp-refresh]").disabled'), 'external MCP settings ready')
  const refresh = async () => { await evaluate('document.querySelector("[data-mcp-refresh]").click()'); await ready() }
  await ready()
  const inspected = await api('inspect', {})
  assert(inspected.ok)
  const clients = inspected.value.clients
  for (const client of clients) {
    assert(client.path.startsWith(resolve(process.env.JOB_BROWSER_SMOKE_DATA, 'agent-home')), 'Only disposable Agent configurations may be touched')
    assert.equal(client.state, 'missing')
    assert.equal(existsSync(client.path), false)
  }
  assert.deepEqual(await api('inspect', { path: '/arbitrary' }), { ok: false, error: 'INVALID_INPUT' })
  assert.deepEqual(await evaluate("window.externalMCP.install({target:'other',revision:'x',replace:true})"), { ok: false, error: 'INVALID_INPUT' })
  const claude = clients.find(client => client.target === 'claude-code'), cursor = clients.find(client => client.target === 'cursor')
  const old = '{"mcpServers":{"job_agent_browser":{"command":"old","env":{"SECRET":"PRIVATE_SMOKE_TOKEN"}}},"retained":true}'
  writeFileSync(claude.path, old)
  mkdirSync(dirname(cursor.path), { recursive: true }); writeFileSync(cursor.path, '{broken')
  await refresh()
  assert.equal(await evaluate(`document.querySelector('${selector('cursor')} [data-mcp-install]').disabled`), true)
  assert.equal(readFileSync(cursor.path, 'utf8'), '{broken')
  assert.equal(await evaluate('document.querySelector("[data-external-mcp]").textContent.includes("PRIVATE_SMOKE_TOKEN")'), false)

  await click('claude-code', 'install')
  await waitFor(() => evaluate('!!document.querySelector("[data-mcp-confirm]").closest("dialog").open'), 'replacement confirmation')
  await evaluate('document.querySelector("[data-mcp-confirm]").closest("dialog").querySelector("button").click()')
  assert.equal(readFileSync(claude.path, 'utf8'), old, 'Cancelling replacement retains the original file')
  await click('claude-code', 'install')
  await evaluate('document.querySelector("[data-mcp-confirm]").click()')
  await waitFor(() => evaluate(`document.querySelector('${selector('claude-code')} [data-mcp-install]').disabled && document.querySelector('${selector('claude-code')}').textContent.includes('MCP configured')`), 'replacement saved')
  const backupPath = await evaluate(`document.querySelectorAll('${selector('claude-code')} dd')[1].textContent`)
  assert.equal(readFileSync(backupPath, 'utf8'), old)
  assert.equal(JSON.parse(readFileSync(claude.path, 'utf8')).retained, true)

  writeFileSync(cursor.path, '// keep comment\n{"mcpServers":{"existing":{"command":"other"}}}')
  await refresh()
  for (const target of ['codex', 'cursor']) {
    await click(target, 'install')
    await waitFor(() => evaluate(`document.querySelector('${selector(target)}').textContent.includes('MCP configured')`), `${target} installed`)
  }
  const codex = (await api('inspect', {})).value.clients.find(client => client.target === 'codex')
  const before = statSync(codex.path).mtimeMs
  const repeated = await api('install', { target: 'codex', revision: codex.revision, replace: false })
  assert(repeated.ok); assert.equal(repeated.value.backupPath, undefined); assert.equal(statSync(codex.path).mtimeMs, before)
  assert(readFileSync(cursor.path, 'utf8').includes('// keep comment'))
  await click('codex', 'test')
  await waitFor(() => evaluate(`document.querySelector('${selector('codex')}').textContent.includes('Connection verified: 42 tools')`), 'real built stdio service discovery')
  for (const target of ['codex', 'claude-code', 'cursor', 'other']) {
    await click(target, 'copy')
    await waitFor(() => evaluate(`document.querySelector('${selector(target)}').textContent.includes('Configuration copied')`), `${target} copied`)
    const expected = target === 'other' ? inspected.value.genericConfig : clients.find(client => client.target === target).config
    assert.equal(await clipboard.readText(), expected)
  }
  const database = resolve(process.env.JOB_BROWSER_SMOKE_DATA, 'database.sqlite')
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    const mode = statSync(database).mode & 0o777
    try {
      chmodSync(database, 0o000)
      await click('codex', 'test')
      await waitFor(() => evaluate(`document.querySelector('${selector('codex')}').textContent.includes('Unable to connect to the MCP service')`), 'sanitized connection failure')
    } finally { chmodSync(database, mode) }
  }
  const size = window.getContentSize(), minimum = window.getMinimumSize()
  await require('./external-skills-smoke.cjs')({ window, evaluate, waitFor })
  await require('./external-integrations-lifecycle-smoke.cjs')({ evaluate, waitFor, capture })
  window.setMinimumSize(320, 320)
  try {
    for (const language of ['en', 'zh-CN']) for (const theme of ['light', 'dark']) {
      assert((await data('settings', 'savePreferences', { language, theme })).ok)
      await waitFor(() => evaluate(`document.documentElement.lang === '${language}' && document.documentElement.dataset.theme === '${theme}'`), 'MCP language and theme')
      for (const width of [320, 640, 1200]) {
        window.setContentSize(width, 900)
        await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        assert.equal(await evaluate('document.querySelector(".settings-page").scrollWidth > document.querySelector(".settings-page").clientWidth'), false, `${language}/${theme}/${width} overflow`)
      }
      await evaluate('document.querySelector("[data-external-mcp]").scrollIntoView()')
      await capture(`external-mcp-${language}-${theme}.png`)
    }
  } finally {
    window.setContentSize(...size); window.setMinimumSize(...minimum)
    await data('settings', 'savePreferences', { language: 'en', theme: 'light' })
    await waitFor(() => evaluate('document.documentElement.lang === "en" && document.documentElement.dataset.theme === "light"'), 'restore Settings appearance')
    await evaluate('document.querySelector(".settings-page").scrollTop = 0')
  }
  console.log('External MCP smoke passed: temporary global configurations, replacement/cancellation, backup, clipboard, real stdio discovery, error feedback and bilingual responsive themes.')
}
