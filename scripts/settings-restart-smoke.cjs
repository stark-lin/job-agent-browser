const { app, safeStorage } = require('electron')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

assert(process.env.JOB_BROWSER_SMOKE_DATA, 'Restart smoke requires the previous process disposable storage')
app.setPath('userData', process.env.JOB_BROWSER_SMOKE_DATA)
const timeout = setTimeout(() => { console.error('Settings restart smoke timed out'); app.exit(1) }, 10_000)
app.once('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const preferences = await window.data.settings.get({});
        const key = await window.data.secrets.hasProviderKey({provider:'openai'});
        const browser = await window.browser.getState();
        await window.browser.navigate('app://settings');
        await new Promise(resolve => {
          const check = () => document.querySelectorAll('.settings-page form:not([data-audit-filters])').length === 4 && document.documentElement.lang === 'zh-CN' ? resolve() : setTimeout(check, 10);
          check();
        });
        return {preferences,key,browser,theme:document.documentElement.dataset.theme,colorScheme:getComputedStyle(document.documentElement).colorScheme,language:document.documentElement.lang,title:document.querySelector('h1').textContent,
          keyInput:document.querySelector('input[type=password]').value};
      })()`)
      assert.equal(result.preferences.value.language, 'zh-CN')
      assert.equal(result.preferences.value.theme, 'dark')
      assert.equal(result.browser.theme, 'dark')
      assert.equal(result.theme, 'dark')
      assert.equal(result.colorScheme, 'dark')
      assert.deepEqual(result.preferences.value.mailbox, { provider: 'custom', url: 'https://example.invalid/mail' })
      assert.equal(result.browser.language, 'zh-CN')
      assert.equal(result.browser.tabs[0].title, '主页')
      assert.equal(result.language, 'zh-CN')
      assert.equal(result.title, '设置')
      assert.equal(result.keyInput, '')
      if (result.key.value.available) {
        assert.equal(result.key.value.configured, true)
        const file = readFileSync(resolve(process.env.JOB_BROWSER_SMOKE_DATA, 'secrets.enc'), 'utf8')
        assert.equal(file.includes('smoke-key-restart'), false)
        assert.equal(safeStorage.decryptString(Buffer.from(JSON.parse(file).providers.openai, 'base64')), 'smoke-key-restart')
      }
      console.log('Settings restart smoke passed: persisted language/theme/mailbox restored before startup and encrypted key restored without exposing it to UI.')
      app.once('will-quit', () => { clearTimeout(timeout); app.exit(0) })
      app.quit()
    } catch (error) { clearTimeout(timeout); console.error(error); app.exit(1) }
  })
})
require(resolve(__dirname, '../out/main/index.js'))
