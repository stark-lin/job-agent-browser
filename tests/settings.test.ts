import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createPreferences } from '../src/platform/storage/preferences'
import { createSecrets, type KeyProtection } from '../src/platform/storage/secrets'
import { defaultPreferences } from '../src/shared/settings'
import { defaultAITimeouts } from '../src/shared/ai'
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
    ...['http://example.com', 'javascript:alert(1)', 'app://home', 'https://user:password@example.com', '', 'https://'].map(url => ({ mailbox: { provider: 'custom', url } })),
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

test('keys are encrypted, replaceable and removable; API returns only status and never audits key material', t => {
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
  assert.equal(JSON.stringify(backend.dispatch('audit', 'list', {})).includes('PRIVATE_KEY'), false)
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
  const ai = { providers: [{ id: 'local', name: 'Local', baseURL: 'http://127.0.0.1:1234/gateway/v1/', requiresKey: false, models: ['custom/model'], defaultModel: 'custom/model' }], default: { providerId: 'local', modelId: 'custom/model' } }
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
    const ai = { providers: [{ id: 'local', name: 'Local', baseURL: endpoint + '/', requiresKey: false, models: [], defaultModel: '' }], default: null }
    createPreferences(path).savePreferences({ ai })
    assert.equal(createPreferences(path).get({}).ai.providers[0].baseURL, endpoint)
  }
})

test('timeout settings retain legacy defaults in memory, persist explicit limits, and reject invalid writes atomically', t => {
  const path = join(temporary(t), 'settings.json'), service = createPreferences(path)
  const legacy = { ...defaultPreferences, ai: { providers: defaultPreferences.ai.providers, default: null } }
  writeFileSync(path, JSON.stringify(legacy))
  assert.deepEqual(service.get({}).ai.timeouts, defaultAITimeouts)
  assert.equal(readFileSync(path, 'utf8'), JSON.stringify(legacy))
  const timeouts = { requestSeconds: 3600, pageSeconds: 1, modelsSeconds: 60 }
  const ai = { ...legacy.ai, timeouts }
  service.savePreferences({ ai })
  assert.deepEqual(createPreferences(path).get({}).ai.timeouts, timeouts)
  assert.deepEqual(service.savePreferences({ language: 'zh-CN', theme: 'dark' }).ai.timeouts, timeouts)
  const before = readFileSync(path, 'utf8')
  for (const invalid of [null, {}, { ...timeouts, other: 10 }, ...[0, -1, 3601, 1.5, '120', null, NaN, Infinity].flatMap(seconds =>
    Object.keys(timeouts).map(field => ({ ...timeouts, [field]: seconds })))]) {
    assert.throws(() => service.savePreferences({ ai: { ...ai, timeouts: invalid } }), { code: 'INVALID_INPUT' })
    assert.equal(readFileSync(path, 'utf8'), before)
  }
})

test('parallel model opt-in persists per provider and survives unrelated preference saves', t => {
  const path = join(temporary(t), 'settings.json'), service = createPreferences(path)
  const ai = { providers: [
    { id: 'first', name: 'First', baseURL: 'https://first.example', requiresKey: false, models: ['model', 'other'], defaultModel: 'model', parallelModels: ['model'] },
    { id: 'second', name: 'Second', baseURL: 'https://second.example', requiresKey: false, models: ['model'], defaultModel: 'model' }
  ], default: { providerId: 'first', modelId: 'model' } }
  service.savePreferences({ ai }); service.savePreferences({ language: 'zh-CN', theme: 'dark' })
  const restored = createPreferences(path).get({})
  assert.deepEqual(restored.ai.providers[0].parallelModels, ['model']); assert.equal(restored.ai.providers[1].parallelModels, undefined)
  const before = readFileSync(path, 'utf8')
  assert.throws(() => service.savePreferences({ ai: { ...ai, providers: [{ ...ai.providers[0], parallelModels: ['absent'] }] } }), /INVALID_INPUT/)
  assert.equal(readFileSync(path, 'utf8'), before)
  service.savePreferences({ ai: { ...restored.ai, providers: restored.ai.providers.map(provider => ({ ...provider, parallelModels: [] })) } })
  assert(service.get({}).ai.providers.every(provider => !provider.parallelModels?.length))
})
