import { smartPasteSettings } from '../src/shared/smart-paste'
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createPreferences } from '../src/platform/storage/preferences'
import { createSecrets, type KeyProtection } from '../src/platform/storage/secrets'
import { defaultPreferences } from '../src/shared/settings'
import { saveAIConnection } from '../src/platform/ai/connection'
import { composeBackend } from '../src/platform/database/backend'
import { openDatabase } from '../src/platform/database/sqlite'

function temporary(t: import('node:test').TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'job-settings-'))
  t.after(() => { chmodSync(directory, 0o700); rmSync(directory, { recursive: true, force: true }) })
  return directory
}

function protection(): KeyProtection {
  const key = randomBytes(32)
  return {
    available: () => true,
    encrypt(value) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    },
    decrypt(value) {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8')
    }
  }
}

test('defaults create no file; partial preferences normalize and survive a fresh service', t => {
  const directory = temporary(t), path = join(directory, 'settings.json')
  const notifications: string[] = [], service = createPreferences(path, value => notifications.push(value.language))
  assert.deepEqual(service.get({}), defaultPreferences)
  assert.equal(existsSync(path), false)
  service.savePreferences({ language: 'zh-CN' })
  service.savePreferences({ mailbox: { provider: 'custom', url: '  https://EXAMPLE.com/mail  ' } })
  const restored = createPreferences(path).get({})
  assert.equal(restored.language, 'zh-CN')
  assert.deepEqual(restored.mailbox, { provider: 'custom', url: 'https://example.com/mail' })
  assert.deepEqual(notifications, ['zh-CN', 'zh-CN'])
  assert.deepEqual(readdirSync(directory), ['settings.json'])
  service.savePreferences({ mailbox: { provider: 'none', url: '' } })
  assert.equal(service.get({}).mailbox.url, '')
})

test('unknown fields, unsupported preferences and unsafe mailbox URLs leave saved preferences intact', t => {
  const path = join(temporary(t), 'settings.json'), service = createPreferences(path)
  service.savePreferences({ language: 'en' })
  const before = readFileSync(path, 'utf8')
  for (const input of [null, [], { autoSave: true }, { theme: 'sepia' }, { theme: undefined }, { theme: null }, { theme: {} }, { language: 'fr' }, { language: undefined },
    ...['http://example.com', 'javascript:alert(1)', 'app://ai', 'https://user:password@example.com', '', 'https://'].map(url => ({ mailbox: { provider: 'custom', url } })),
    { mailbox: { provider: 'other', url: 'https://example.com' } }, { mailbox: { provider: 'none', url: 'https://example.com' } }]) {
    assert.throws(() => service.savePreferences(input), { code: 'INVALID_INPUT' })
    assert.equal(readFileSync(path, 'utf8'), before)
  }
})

test('all themes persist, partial saves preserve them, and old version-1 light files remain compatible', t => {
  const path = join(temporary(t), 'settings.json'), notifications: string[] = []
  writeFileSync(path, JSON.stringify(defaultPreferences))
  const service = createPreferences(path, value => notifications.push(value.theme))
  assert.deepEqual(service.get({}), defaultPreferences)
  for (const theme of ['dark', 'system', 'light'] as const) {
    assert.equal(service.savePreferences({ theme }).theme, theme)
    assert.equal(createPreferences(path).get({}).theme, theme)
    assert.equal(service.savePreferences({ language: 'zh-CN' }).theme, theme)
    assert.equal(service.savePreferences({ mailbox: { provider: 'none', url: '' } }).theme, theme)
  }
  assert.deepEqual(notifications, ['dark', 'dark', 'dark', 'system', 'system', 'system', 'light', 'light', 'light'])
})

test('corrupt and future configuration fails without resetting or replacing user files', t => {
  const path = join(temporary(t), 'settings.json'), service = createPreferences(path)
  for (const body of ['{broken', JSON.stringify({ ...defaultPreferences, version: 2 }), JSON.stringify({ ...defaultPreferences, language: 'fr' })]) {
    writeFileSync(path, body)
    assert.throws(() => service.get({}), { code: 'STORAGE_UNAVAILABLE' })
    assert.throws(() => service.savePreferences({ language: 'en' }), { code: 'STORAGE_UNAVAILABLE' })
    assert.equal(readFileSync(path, 'utf8'), body)
  }
})

test('an unwritable preference directory preserves the previous file and emits no success', t => {
  if (process.platform === 'win32' || process.getuid?.() === 0) { t.skip('POSIX directory permissions required; Windows/root cannot enforce chmod'); return }
  const directory = temporary(t), path = join(directory, 'settings.json'), notifications: string[] = []
  const service = createPreferences(path, value => notifications.push(value.language))
  service.savePreferences({ language: 'en' })
  const before = readFileSync(path, 'utf8')
  chmodSync(directory, 0o500)
  assert.throws(() => service.savePreferences({ language: 'zh-CN', theme: 'dark' }))
  assert.equal(readFileSync(path, 'utf8'), before)
  assert.deepEqual(notifications, ['en'])
})

test('keys are encrypted, replaceable and removable; API returns only status and never returns key material', t => {
  const directory = temporary(t), path = join(directory, 'secrets.enc'), protector = protection()
  const secrets = createSecrets(path, protector), settings = createPreferences(join(directory, 'settings.json'))
  const backend = composeBackend(openDatabase(':memory:'), { secrets, settings })
  t.after(backend.close)
  assert.deepEqual(secrets.hasProviderKey({ provider: 'openai' }), { configured: false, available: true })
  assert.equal(existsSync(path), false)
  const saved = backend.dispatch('secrets', 'saveProviderKey', { provider: 'openai', apiKey: 'PRIVATE_KEY_ONE' })
  assert.deepEqual(saved, { ok: true, value: { configured: true, available: true } })
  let body = readFileSync(path, 'utf8')
  assert.equal(body.includes('PRIVATE_KEY_ONE'), false)
  assert.equal(protector.decrypt(Buffer.from(JSON.parse(body).providers.openai, 'base64')), 'PRIVATE_KEY_ONE')
  secrets.saveProviderKey({ provider: 'openai', apiKey: 'PRIVATE_KEY_TWO' })
  body = readFileSync(path, 'utf8')
  assert.equal(protector.decrypt(Buffer.from(JSON.parse(body).providers.openai, 'base64')), 'PRIVATE_KEY_TWO')
  assert.deepEqual(createSecrets(path, protector).hasProviderKey({ provider: 'openai' }), { configured: true, available: true })
  assert.equal(JSON.stringify(backend.dispatch('secrets', 'hasProviderKey', { provider: 'custom' })).includes('PRIVATE_KEY'), false)
  assert.deepEqual(secrets.deleteProviderKey({ provider: 'openai' }), { configured: false, available: true })
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).providers.openai, undefined)
})

test('unavailable encryption and encryption failures preserve the key; invalid input is rejected', t => {
  const path = join(temporary(t), 'secrets.enc'), protector = protection(), service = createSecrets(path, protector)
  service.saveProviderKey({ provider: 'openai', apiKey: 'PRIVATE_KEY' })
  const before = readFileSync(path, 'utf8')
  const unavailable = createSecrets(path, { ...protector, available: () => false })
  assert.deepEqual(unavailable.hasProviderKey({ provider: 'openai' }), { configured: true, available: false })
  assert.throws(() => unavailable.saveProviderKey({ provider: 'openai', apiKey: 'REPLACEMENT' }), { code: 'ENCRYPTION_UNAVAILABLE' })
  const broken = createSecrets(path, { ...protector, encrypt: () => { throw new Error('Encryption failed') } })
  assert.throws(() => broken.saveProviderKey({ provider: 'openai', apiKey: 'REPLACEMENT' }))
  for (const input of [{ provider: '__proto__', apiKey: 'KEY' }, { provider: 'openai', apiKey: '' }, { provider: 'openai', apiKey: 'two words' }, { provider: 'openai', apiKey: 'KEY', extra: true }]) {
    assert.throws(() => service.saveProviderKey(input), { code: 'INVALID_INPUT' })
  }
  assert.equal(readFileSync(path, 'utf8'), before)
  assert.deepEqual(unavailable.deleteProviderKey({ provider: 'openai' }), { configured: false, available: false })
})

test('legacy OpenAI ciphertext migrates on write without decrypting other providers', t => {
  const path = join(temporary(t), 'secrets.enc'), protector = protection()
  const old = JSON.stringify({ version: 1, openai: protector.encrypt('LEGACY_PRIVATE_KEY').toString('base64') })
  writeFileSync(path, old)
  const service = createSecrets(path, protector)
  assert.equal(service.readProviderKey('openai'), 'LEGACY_PRIVATE_KEY')
  assert.equal(readFileSync(path, 'utf8'), old)
  service.saveProviderKey({ provider: 'company', apiKey: 'COMPANY_PRIVATE_KEY' })
  assert.equal(createSecrets(path, protector).readProviderKey('openai'), 'LEGACY_PRIVATE_KEY')
  assert.equal(service.readProviderKey('company'), 'COMPANY_PRIVATE_KEY')
  service.deleteProviderKey({ provider: 'company' })
  assert.equal(service.readProviderKey('company'), null)
  assert.equal(service.readProviderKey('openai'), 'LEGACY_PRIVATE_KEY')
  assert.equal(readFileSync(path, 'utf8').includes('PRIVATE_KEY'), false)
})

test('old settings gain AI defaults; custom provider configuration persists and validates atomically', t => {
  const path = join(temporary(t), 'settings.json')
  const legacy = { version: 1, theme: defaultPreferences.theme, language: defaultPreferences.language, mailbox: defaultPreferences.mailbox }
  writeFileSync(path, JSON.stringify(legacy))
  const service = createPreferences(path)
  assert.deepEqual(service.get({}).ai, defaultPreferences.ai)
  assert.equal(readFileSync(path, 'utf8'), JSON.stringify(legacy))
  const ai = { providers: [{ id: 'local', name: 'Local', baseURL: 'http://127.0.0.1:1234/gateway/v1/', models: ['custom/model'] }], default: { providerId: 'local', modelId: 'custom/model' } }
  service.savePreferences({ ai })
  const restored = createPreferences(path).get({})
  assert.equal(restored.ai.providers[0].baseURL, 'http://127.0.0.1:1234/gateway/v1')
  assert.deepEqual(restored.ai.default, ai.default)
  assert.deepEqual(service.savePreferences({ theme: 'dark' }).ai, restored.ai)
  const before = readFileSync(path, 'utf8')
  for (const invalid of [
    { ...ai, default: { providerId: 'missing', modelId: 'custom/model' } },
    { ...ai, providers: [...ai.providers, ...ai.providers] },
    ...['http://example.com/v1', 'https://user:pass@example.com', 'https://example.com/v1?token=secret', 'file:///tmp'].map(baseURL => ({ ...ai, providers: [{ ...ai.providers[0], baseURL }] })),
    { ...ai, providers: [{ ...ai.providers[0], models: ['duplicate', 'duplicate'] }] }
  ]) assert.throws(() => service.savePreferences({ ai: invalid }), { code: 'INVALID_INPUT' })
  assert.equal(readFileSync(path, 'utf8'), before)
})

test('bare local and hosted OpenAI endpoints survive settings reload without requiring models', t => {
  const path = join(temporary(t), 'settings.json')
  for (const endpoint of ['http://127.0.0.1:1234', 'http://localhost:1234', 'http://[::1]:1234', 'https://api.openai.com']) {
    const ai = { providers: [{ id: 'local', name: 'Local', baseURL: endpoint + '/', models: [] }], default: null }
    createPreferences(path).savePreferences({ ai })
    assert.equal(createPreferences(path).get({}).ai.providers[0].baseURL, endpoint)
  }
})

test('legacy default timeouts are dropped and custom timeouts persist as overrides', t => {
  const path = join(temporary(t), 'settings.json'), service = createPreferences(path)
  const oldDefaults = { requestSeconds: 120, pageSeconds: 20, modelsSeconds: 15 }
  const legacy = { ...defaultPreferences, ai: { ...defaultPreferences.ai, timeouts: oldDefaults } }
  writeFileSync(path, JSON.stringify(legacy))
  assert.equal(service.get({}).ai.timeoutOverrides, undefined)
  assert.equal(readFileSync(path, 'utf8'), JSON.stringify(legacy))
  const timeouts = { requestSeconds: 3600, pageSeconds: 1, modelsSeconds: 60 }
  writeFileSync(path, JSON.stringify({ ...legacy, ai: { ...legacy.ai, timeouts: { ...oldDefaults, modelsSeconds: 45 } } }))
  assert.deepEqual(service.get({}).ai.timeoutOverrides, { modelsSeconds: 45 })
  const ai = { ...defaultPreferences.ai, timeoutOverrides: timeouts }
  service.savePreferences({ ai })
  assert.deepEqual(createPreferences(path).get({}).ai.timeoutOverrides, timeouts)
  assert.deepEqual(service.savePreferences({ language: 'zh-CN', theme: 'dark' }).ai.timeoutOverrides, timeouts)
  const before = readFileSync(path, 'utf8')
  for (const invalid of [null, { ...timeouts, other: 10 }, ...[0, -1, 3601, 1.5, '120', null, NaN, Infinity].flatMap(seconds =>
    Object.keys(timeouts).map(field => ({ ...timeouts, [field]: seconds })))]) {
    assert.throws(() => service.savePreferences({ ai: { ...ai, timeoutOverrides: invalid } }), { code: 'INVALID_INPUT' })
    assert.equal(readFileSync(path, 'utf8'), before)
  }
})

test('legacy parallel import settings are ignored on read and dropped on the next save', t => {
  const path = join(temporary(t), 'settings.json'), service = createPreferences(path)
  const provider = { id: 'first', name: 'First', baseURL: 'https://first.example', models: ['model'] }
  service.savePreferences({ ai: { providers: [provider], default: { providerId: 'first', modelId: 'model' } } })
  const stored = JSON.parse(readFileSync(path, 'utf8'))
  stored.ai.providers[0].parallelModels = ['model']
  writeFileSync(path, JSON.stringify(stored))
  assert.deepEqual(service.get({}).ai.providers[0], provider)
  assert(readFileSync(path, 'utf8').includes('parallelModels'))
  service.savePreferences({ language: 'zh-CN' })
  assert(!readFileSync(path, 'utf8').includes('parallelModels'))
})

test('Smart Paste defaults follow legacy preferences, while explicit deletion and rejected edits survive reload', t => {
  const path = join(temporary(t), 'settings.json'), service = createPreferences(path)
  const id = '312cb02a-05ea-49b6-8b88-4b5a055006ec'
  assert.equal(smartPasteSettings(service.get({})).configs[0].title, 'Personal introduction')
  service.savePreferences({ language: 'zh-CN' })
  assert.equal(smartPasteSettings(createPreferences(path).get({})).configs[0].title, '个人简介')
  const { smartPaste } = service.savePreferences({ smartPaste: { configs: [{ id, title: ' New title ', prompt: ' Run this. ' }] } })
  assert.deepEqual(smartPaste?.configs, [{ id, title: 'New title', prompt: 'Run this.' }])
  assert.throws(() => service.savePreferences({ smartPaste: { configs: [{ id, title: ' ', prompt: 'Run this.' }] } }), { code: 'INVALID_INPUT' })
  assert.deepEqual(createPreferences(path).get({}).smartPaste, smartPaste)
  service.savePreferences({ smartPaste: { configs: [] } })
  service.savePreferences({ language: 'en', theme: 'system' })
  assert.deepEqual(smartPasteSettings(createPreferences(path).get({})).configs, [])
})

test('setup completion survives restart and unrelated saves; restarting setup preserves user data', t => {
  const path = join(temporary(t), 'settings.json'), service = createPreferences(path)
  assert.equal(service.get({}).onboardingCompleted, undefined)
  service.savePreferences({ onboardingCompleted: true, theme: 'dark', language: 'zh-CN' })
  assert.equal(createPreferences(path).get({}).onboardingCompleted, true)
  const completed = service.get({})
  service.savePreferences({ onboardingCompleted: false })
  assert.deepEqual(service.get({}), { ...completed, onboardingCompleted: false })
  service.savePreferences({ language: 'en' })
  assert.equal(service.get({}).onboardingCompleted, false)
  const before = readFileSync(path, 'utf8')
  for (const onboardingCompleted of [null, undefined, 'true', 1, {}, []]) {
    assert.throws(() => service.savePreferences({ onboardingCompleted }), { code: 'INVALID_INPUT' })
    assert.equal(readFileSync(path, 'utf8'), before)
  }
})

test('legacy AI providers restore the default and preserve only manual overrides', t => {
  const directory = temporary(t), path = join(directory, 'settings.json')
  const legacyProvider = {
    id: 'legacy', name: 'Legacy', baseURL: 'https://provider.example/v1', requiresKey: true,
    models: ['manual', 'detected'], defaultModel: 'manual',
    capabilities: {
      manual: { contextWindow: 16384, maxOutputTokens: 2048, source: 'manual', verified: true },
      detected: { contextWindow: 65536, maxOutputTokens: 8192, source: 'runtime', verified: true }
    }
  }
  writeFileSync(path, JSON.stringify({ ...defaultPreferences, ai: { providers: [legacyProvider] } }))
  const preferences = createPreferences(path), secrets = createSecrets(join(directory, 'secrets.enc'), protection())
  secrets.saveProviderKey({ provider: 'legacy', apiKey: 'PRIVATE_KEY' })
  const restored = preferences.get({}).ai
  assert.deepEqual(restored.default, { providerId: 'legacy', modelId: 'manual' })
  assert.deepEqual(restored.providers[0], { id: 'legacy', name: 'Legacy', baseURL: 'https://provider.example/v1',
    models: ['manual', 'detected'], overrides: { manual: { contextWindow: 16384, maxOutputTokens: 2048 } } })
  preferences.savePreferences({ theme: 'dark' })
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).ai, restored)
  assert.equal(secrets.readProviderKey('legacy'), 'PRIVATE_KEY')
})

test('connection saves retain or clear credentials by endpoint and recover from a failed preference write', t => {
  const directory = temporary(t), settingsDir = join(directory, 'settings')
  const preferences = createPreferences(join(settingsDir, 'settings.json'))
  const secrets = createSecrets(join(directory, 'secrets.enc'), protection())
  const provider = { id: 'local', name: 'Fixture', baseURL: 'https://first.example/v1', models: ['model'] }
  const draft = { provider, modelId: 'model' }
  saveAIConnection(preferences, secrets, { ...draft, apiKey: 'ORIGINAL', timeoutOverrides: { modelsSeconds: 30 } })
  const existing = { ...draft, previousEndpoint: provider.baseURL }
  const retained = saveAIConnection(preferences, secrets, { ...existing, provider: { ...provider, name: 'Renamed' } })
  assert.equal(secrets.readProviderKey(provider.id), 'ORIGINAL')
  assert.deepEqual(retained.ai.timeoutOverrides, { modelsSeconds: 30 })

  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    chmodSync(settingsDir, 0o500)
    try { assert.throws(() => saveAIConnection(preferences, secrets, { ...existing, apiKey: 'REPLACEMENT' })) }
    finally { chmodSync(settingsDir, 0o700) }
    assert.equal(secrets.readProviderKey(provider.id), 'ORIGINAL')
    assert.deepEqual(preferences.get({}), retained)
  }

  const updated = saveAIConnection(preferences, secrets, { ...existing, provider: { ...provider, baseURL: 'https://second.example/v1' }, timeoutOverrides: {} })
  assert.equal(secrets.readProviderKey(provider.id), null)
  assert.equal(updated.ai.timeoutOverrides, undefined)
  assert.equal(updated.ai.providers.find(p => p.id === provider.id)?.baseURL, 'https://second.example/v1')
})
