import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createPreferences } from '../src/platform/storage/preferences'
import { createSecrets, type KeyProtection } from '../src/platform/storage/secrets'
import { defaultPreferences } from '../src/shared/settings'
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
  if (process.getuid?.() === 0) { t.skip('Root bypasses directory permissions'); return }
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
  assert.equal(protector.decrypt(Buffer.from(JSON.parse(body).openai, 'base64')), 'PRIVATE_KEY_ONE')
  secrets.saveProviderKey({ provider: 'openai', apiKey: 'PRIVATE_KEY_TWO' })
  body = readFileSync(path, 'utf8')
  assert.equal(protector.decrypt(Buffer.from(JSON.parse(body).openai, 'base64')), 'PRIVATE_KEY_TWO')
  assert.deepEqual(createSecrets(path, protector).hasProviderKey({ provider: 'openai' }), { configured: true, available: true })
  assert.equal(JSON.stringify(backend.dispatch('audit', 'list', {})).includes('PRIVATE_KEY'), false)
  assert.deepEqual(secrets.deleteProviderKey({ provider: 'openai' }), { configured: false, available: true })
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).openai, null)
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
  for (const input of [{ provider: 'other', apiKey: 'KEY' }, { provider: 'openai', apiKey: '' }, { provider: 'openai', apiKey: 'two words' }, { provider: 'openai', apiKey: 'KEY', extra: true }]) {
    assert.throws(() => service.saveProviderKey(input), { code: 'INVALID_INPUT' })
  }
  assert.equal(readFileSync(path, 'utf8'), before)
  assert.deepEqual(unavailable.deleteProviderKey({ provider: 'openai' }), { configured: false, available: false })
})
