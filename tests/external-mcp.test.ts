import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseTOML } from '../src/platform/storage/toml'
import { parse as parseJSONC } from 'jsonc-parser'
import { externalMCPTargets, type ExternalMCPTarget } from '../src/shared/external-mcp'
import { createExternalMCPConfig, externalMCPEntry, externalMCPPath, externalMCPText, externalMCPError, type MCPLaunch } from '../src/platform/mcp/external-config'
import { createExternalMCPInstaller } from '../src/platform/mcp/external-install'
import { createExternalMCPBridge } from '../src/platform/electron/preload/external-mcp-bridge'
import { createMCPClient, type MCPClient } from '../src/platform/mcp/client'
import { firstPartyFixture } from './first-party-fixture'
import { jobAgentAllowlist } from '../src/platform/tools'

function fixture(t: TestContext) {
  const home = mkdtempSync(join(tmpdir(), 'external mcp '))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const launch: MCPLaunch = { command: process.execPath, args: [join(home, 'built entry', 'job-agent-mcp.js')],
    env: { ELECTRON_RUN_AS_NODE: '1', JOB_BROWSER_USER_DATA: join(home, 'user data'), JOB_BROWSER_ELECTRON: process.execPath } }
  return { home, launch, config: createExternalMCPConfig({ home }, launch) }
}
function save(path: string, body: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body) }
const decode = (target: ExternalMCPTarget, body: string): Record<string, unknown> => target === 'codex' ? parseTOML(body, { integersAsBigInt: true }) : parseJSONC(body)

for (const target of externalMCPTargets) {
  test(`${target}: reconnect republishes reviewed configuration and removal retains unrelated settings with backups`, t => {
    const f = fixture(t), path = externalMCPPath(target, f)
    assert.equal(f.config.remove(target, f.config.inspect(target).revision).status.state, 'missing')
    assert(!existsSync(path))
    const installed = f.config.install(target, f.config.inspect(target).revision, false)
    const original = readFileSync(path, 'utf8')
    const connected = f.config.reconnect(target, installed.status.revision)
    assert.notEqual(connected.status.revision, installed.status.revision)
    assert.equal(readFileSync(path, 'utf8'), original)
    assert.equal(readFileSync(connected.backupPath!, 'utf8'), original)
    assert.throws(() => f.config.remove(target, installed.status.revision), { code: 'CONFIG_CHANGED' })
    const prefix = target === 'codex' ? 'model = "keep"\n[mcp_servers.unrelated]\ncommand = "keep"\n' : undefined
    save(path, target === 'codex' ? prefix + original : JSON.stringify({ keep: true,
      mcpServers: { unrelated: { command: 'keep' }, job_agent_browser: externalMCPEntry(target, f.launch) } }))
    const before = readFileSync(path, 'utf8'), removed = f.config.remove(target, f.config.inspect(target).revision)
    assert.equal(removed.status.state, 'missing')
    assert.equal(readFileSync(removed.backupPath!, 'utf8'), before)
    const remaining = decode(target, readFileSync(path, 'utf8'))
    assert.deepEqual(JSON.parse(JSON.stringify(remaining[target === 'codex' ? 'mcp_servers' : 'mcpServers'])), { unrelated: { command: 'keep' } })
    assert.equal(remaining[target === 'codex' ? 'model' : 'keep'], target === 'codex' ? 'keep' : true)
    assert.throws(() => f.config.reconnect(target, removed.status.revision), { code: 'REPLACE_REQUIRED' })
    assert.equal(f.config.remove(target, removed.status.revision).backupPath, undefined)
  })
}

test('lifecycle requests reject arbitrary inputs and removal needs no runnable service', async t => {
  const f = fixture(t)
  const service = createExternalMCPInstaller({ ...f, directory: f.home, bundleDirectory: f.home, executable: '/not-installed', writeClipboard() {} })
  const status = service.inspect({}).clients[0]
  assert.equal(service.remove({ target: 'codex', revision: status.revision }).status.state, 'missing')
  for (const request of [{ target: 'other', revision: status.revision }, { target: 'codex', revision: 'bad' },
    { target: 'codex', revision: status.revision, path: '/arbitrary' }]) {
    assert.throws(() => service.remove(request), { code: 'INVALID_INPUT' })
    await assert.rejects(service.reconnect(1, request), { code: 'INVALID_INPUT' })
  }
})

for (const target of externalMCPTargets) {
  test(`${target}: global installation preserves other settings, backs up originals and is idempotent`, t => {
    const f = fixture(t), path = externalMCPPath(target, f)
    assert.equal(f.config.inspect(target).state, 'missing')
    assert(!existsSync(path), 'inspection does not create files')
    const original = target === 'codex'
      ? 'model = "custom/model"\nlarge = 9223372036854775807\nfloat = 1.0\n[projects."/with spaces"]\ntrust_level = "trusted"\n[mcp_servers.existing]\ncommand = "other"\n'
      : `${target === 'cursor' ? '// retained comment\n' : ''}{"model":"custom/model","projects":{"/with spaces":{"trusted":true}},"mcpServers":{"existing":{"command":"other","env":{"API_KEY":"PRIVATE_TOKEN"}}}}`
    save(path, original)
    const before = decode(target, original), missing = f.config.inspect(target)
    const result = f.config.install(target, missing.revision, false)
    assert.equal(result.status.state, 'configured')
    assert.equal(readFileSync(result.backupPath!, 'utf8'), original)
    const written = readFileSync(path, 'utf8'), after = decode(target, written), group = target === 'codex' ? 'mcp_servers' : 'mcpServers'
    const servers = after[group] as Record<string, unknown>
    assert.deepEqual(servers.existing, (before[group] as Record<string, unknown>).existing)
    delete servers.job_agent_browser
    assert.deepEqual(after, before)
    if (target === 'cursor') assert(written.includes('// retained comment'))
    const fileBefore = statSync(path), backupsBefore = readdirSync(dirname(path))
    const again = f.config.install(target, result.status.revision, false)
    assert.equal(again.backupPath, undefined)
    assert.equal(statSync(path).mtimeMs, fileBefore.mtimeMs)
    assert.deepEqual(readdirSync(dirname(path)), backupsBefore)
    assert(!JSON.stringify(result).includes('PRIVATE_TOKEN'))
  })

  test(`${target}: a conflicting entry requires confirmation and replaces only that entry`, t => {
    const f = fixture(t), path = externalMCPPath(target, f)
    const original = target === 'codex' ? '[mcp_servers.job_agent_browser]\ncommand = "old"\nurl = "https://old.invalid"\n' :
      '{"mcpServers":{"job_agent_browser":{"command":"old","url":"https://old.invalid","env":{"SECRET":"PRIVATE_TOKEN"}}},"retained":true}'
    save(path, original)
    const status = f.config.inspect(target)
    assert.equal(status.state, 'different')
    assert.throws(() => f.config.install(target, status.revision, false), { code: 'REPLACE_REQUIRED' })
    assert.equal(readFileSync(path, 'utf8'), original, 'declining replacement leaves the file intact')
    const result = f.config.install(target, status.revision, true)
    assert.equal(result.status.state, 'configured')
    assert.equal(readFileSync(result.backupPath!, 'utf8'), original)
    const after = decode(target, readFileSync(path, 'utf8')), group = after[target === 'codex' ? 'mcp_servers' : 'mcpServers'] as Record<string, unknown>
    const entry = group.job_agent_browser as Record<string, unknown>
    assert.deepEqual({ ...entry, env: { ...entry.env as Record<string, unknown> } }, target === 'codex' ?
      { ...externalMCPEntry(target, f.launch), tool_timeout_sec: 100n } : externalMCPEntry(target, f.launch))
  })

  test(`${target}: corrupt, structurally invalid and concurrently modified files are retained`, t => {
    const f = fixture(t), path = externalMCPPath(target, f)
    const invalid = target === 'codex' ? ['[broken', 'mcp_servers = []'] : ['{broken', '[]', '{"mcpServers":[]}']
    for (const body of invalid) {
      save(path, body)
      assert.equal(f.config.inspect(target).state, 'invalid')
      assert.throws(() => f.config.install(target, f.config.inspect(target).revision, true), { code: 'CONFIG_INVALID' })
      assert.equal(readFileSync(path, 'utf8'), body)
    }
    save(path, target === 'codex' ? 'model = "first"' : '{"model":"first"}')
    const snapshot = f.config.inspect(target)
    const changed = target === 'codex' ? 'model = "second"' : '{"model":"second"}'
    save(path, changed)
    assert.throws(() => f.config.install(target, snapshot.revision, true), { code: 'CONFIG_CHANGED' })
    assert.equal(readFileSync(path, 'utf8'), changed)
    assert(!readdirSync(dirname(path)).some(file => /\.(bak|tmp)$/.test(file)))
  })
}

test('missing configuration creates only the chosen global entry; CODEX_HOME and generated caller environments are explicit', t => {
  const f = fixture(t), codexHome = join(f.home, 'custom codex')
  const config = createExternalMCPConfig({ home: f.home, codexHome }, f.launch)
  const status = config.inspect('codex'), result = config.install('codex', status.revision, false)
  assert.equal(status.path, join(codexHome, 'config.toml'))
  assert.equal(result.status.state, 'configured'); assert.equal(result.backupPath, undefined)
  assert(!existsSync(join(f.home, '.codex')))
  for (const target of [...externalMCPTargets, 'other'] as const) {
    const value = decode(target === 'codex' ? 'codex' : 'cursor', externalMCPText(target, f.launch))
    const group = value[target === 'codex' ? 'mcp_servers' : 'mcpServers'] as Record<string, { env: Record<string, string> }>
    assert.equal(group.job_agent_browser.env.JOB_BROWSER_MCP_CALLER, target === 'other' ? 'mcp-client' : target)
    assert.equal(group.job_agent_browser.env.JOB_BROWSER_ELECTRON, process.execPath)
    assert.equal(group.job_agent_browser.env.JOB_BROWSER_USER_DATA, f.launch.env.JOB_BROWSER_USER_DATA)
  }
})

test('symlinks retain their destination; dangling links and unavailable files are never replaced', t => {
  const f = fixture(t), path = externalMCPPath('claude-code', f), actual = join(f.home, 'managed.json')
  save(actual, '{"retained":true}'); symlinkSync(actual, path)
  const saved = f.config.inspect('claude-code')
  assert.equal(f.config.install('claude-code', saved.revision, false).status.state, 'configured')
  assert(lstatSync(path).isSymbolicLink())
  rmSync(actual)
  assert.equal(f.config.inspect('claude-code').state, 'unavailable')
  assert.throws(() => f.config.install('claude-code', saved.revision, true))
  assert(lstatSync(path).isSymbolicLink())
})

test('read and write permission failures retain original configuration without reporting success', t => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('POSIX permissions required; Windows/root cannot enforce chmod')
  const f = fixture(t), path = externalMCPPath('cursor', f), body = '{"retained":true}'
  save(path, body)
  const status = f.config.inspect('cursor')
  chmodSync(dirname(path), 0o500)
  try {
    assert.throws(() => f.config.install('cursor', status.revision, false))
    assert.equal(readFileSync(path, 'utf8'), body)
  } finally { chmodSync(dirname(path), 0o700) }
  chmodSync(path, 0o000)
  try { assert.equal(f.config.inspect('cursor').state, 'unavailable') }
  finally { chmodSync(path, 0o600) }
})

test('installer validates requests, copies generated text only and sanitizes runtime and clipboard failures', async t => {
  const f = fixture(t), copied: string[] = []
  const service = createExternalMCPInstaller({ ...f, directory: f.home, bundleDirectory: f.home,
    executable: process.execPath, writeClipboard: value => { copied.push(value) } })
  assert.throws(() => service.inspect({ path: '/arbitrary' }), { code: 'INVALID_INPUT' })
  for (const input of [{}, { target: 'other', revision: 'x', replace: true }, { target: 'codex', revision: '0'.repeat(64), replace: 'yes' }]) {
    assert.throws(() => service.install(input), { code: 'INVALID_INPUT' })
  }
  assert.equal(await service.copy({ target: 'other' }), null)
  assert.deepEqual(copied, [externalMCPText('other', { command: process.execPath, args: [join(f.home, 'job-agent-mcp.js')], env: {
    ELECTRON_RUN_AS_NODE: '1', JOB_BROWSER_USER_DATA: f.home, JOB_BROWSER_ELECTRON: process.execPath
  } })])
  const status = service.inspect({}).clients[0]
  assert.throws(() => service.install({ target: status.target, revision: status.revision, replace: false }), { code: 'RUNTIME_UNAVAILABLE' })
  assert(!existsSync(status.path))
  assert.equal(externalMCPError(new Error('PRIVATE_TOKEN')), 'CONFIG_UNAVAILABLE')
  const broken = createExternalMCPInstaller({ ...f, directory: f.home, bundleDirectory: f.home, executable: process.execPath,
    async writeClipboard() { await Promise.resolve(); throw new Error('PRIVATE_TOKEN') } })
  await assert.rejects(broken.copy({ target: 'cursor' }), { code: 'COPY_FAILED' })
})

test('real generated stdio configuration discovers the public tools without business writes and closes its process', async t => {
  const f = await firstPartyFixture(t)
  writeFileSync(join(f.directory, 'resume-output-worker.js'), '// not invoked by discovery')
  let client: MCPClient | undefined, closed = false
  const service = createExternalMCPInstaller({ home: join(f.directory, 'agent home'), directory: f.directory, bundleDirectory: f.directory,
    executable: process.execPath, writeClipboard() {}, clientFactory: launch => {
      client = createMCPClient({ id: 'setup', enabled: true, transport: 'stdio', command: launch.command, args: launch.args, tools: [] },
        { closed() { closed = true }, changed() {} }, { processEnv: launch.env })
      return client
    } })
  const before = f.backend.dispatch('audit', 'list', {})
  const status = service.inspect({}).clients[0]
  service.install({ target: status.target, revision: status.revision, replace: false })
  assert.deepEqual(await service.test(1, { target: 'codex' }), { toolCount: jobAgentAllowlist.length })
  assert(closed)
  assert.equal(f.outputs(), 0)
  assert.deepEqual(f.backend.dispatch('audit', 'list', {}), before)
  await assert.rejects(client!.listTools(), { code: 'TOOL_UNAVAILABLE' })
  const current = service.inspect({}).clients[0]
  const reconnect = await service.reconnect(1, { target: 'codex', revision: current.revision })
  assert.equal(reconnect.toolCount, jobAgentAllowlist.length)
  assert.equal(reconnect.error, undefined)
  assert.equal(f.outputs(), 0)
  assert.deepEqual(f.backend.dispatch('audit', 'list', {}), before)
  assert(reconnect.backupPath)
  assert.equal(service.remove({ target: 'codex', revision: reconnect.status.revision }).status.state, 'missing')
  await assert.rejects(service.test(1, { target: 'other' }), { code: 'INVALID_INPUT' })
})

test('failed discovery is sanitized and the client closes; owner disposal aborts pending tests', async t => {
  const f = fixture(t)
  for (const name of ['database.sqlite', 'job-agent-mcp.js', 'resume-output-worker.js']) writeFileSync(join(f.home, name), '')
  let closed = 0, calls = 0
  const service = createExternalMCPInstaller({ ...f, directory: f.home, bundleDirectory: f.home, executable: process.execPath,
    writeClipboard() {}, clientFactory: () => ({
      async connect(signal) { calls++; if (calls > 1) await new Promise((_, reject) => signal!.addEventListener('abort', () => reject(new Error('PRIVATE_TOKEN')), { once: true })) },
      async listTools() { throw new Error('PRIVATE_TOKEN') },
      async callTool() { throw new Error('business tools must not be called') },
      async close() { closed++ }
    }) })
  const status = service.inspect({}).clients[0]
  service.install({ target: status.target, revision: status.revision, replace: false })
  await assert.rejects(service.test(1, { target: 'codex' }), { code: 'CONNECTION_FAILED' })
  const pending = service.test(2, { target: 'codex' })
  service.remove({ target: 'codex', revision: service.inspect({}).clients[0].revision })
  await assert.rejects(pending, { code: 'CONNECTION_FAILED' })
  assert.equal(closed, 2)
  service.dispose()
})

test('failed reconnect reports saved configuration separately from discovery failure', async t => {
  const f = fixture(t)
  for (const name of ['database.sqlite', 'job-agent-mcp.js', 'resume-output-worker.js']) writeFileSync(join(f.home, name), '')
  let closed = false
  const service = createExternalMCPInstaller({ ...f, directory: f.home, bundleDirectory: f.home, executable: process.execPath,
    writeClipboard() {}, clientFactory: () => ({ async connect() { throw new Error('private process output') },
      async listTools() { return [] }, async callTool() { throw new Error('business tools must not be called') }, async close() { closed = true } }) })
  const installed = service.install({ target: 'codex', revision: service.inspect({}).clients[0].revision, replace: false })
  const result = await service.reconnect(1, { target: 'codex', revision: installed.status.revision })
  assert.equal(result.status.state, 'configured')
  assert.equal(result.error, 'CONNECTION_FAILED')
  assert.equal(result.toolCount, undefined)
  assert(result.backupPath)
  assert(closed)
  assert(!JSON.stringify(result).includes('private process output'))
})

test('preload exposes only the named setup and lifecycle operations', async () => {
  const calls: unknown[] = []
  const bridge = createExternalMCPBridge(async (method, input) => { calls.push([method, input]); return { ok: true, value: null } })
  assert.deepEqual(Object.keys(bridge), ['inspect', 'install', 'reconnect', 'remove', 'test', 'copy'])
  await bridge.inspect({}); await bridge.copy({ target: 'other' })
  const change = { target: 'codex' as const, revision: 'a'.repeat(64) }
  await bridge.reconnect(change); await bridge.remove(change)
  assert.deepEqual(calls, [['inspect', {}], ['copy', { target: 'other' }], ['reconnect', change], ['remove', change]])
})
