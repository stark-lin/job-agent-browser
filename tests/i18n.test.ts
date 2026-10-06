import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { createTranslationInstance } from '../src/shared/i18n'
import { PlaceholderPage } from '../src/shared/ui/PlaceholderPage'
import { TabStrip } from '../src/pages/browser/TabStrip'
import type { BrowserTabState } from '../src/shared/browser'

test('bundled copy is ready synchronously for startup dialogs and falls back to English', async () => {
  const instance = createTranslationInstance()
  assert.equal(instance.isInitialized, true)
  assert.equal(instance.t($ => $.errors.storageTitle), 'Storage unavailable')
  assert.equal(instance.t($ => $.navigation.pages.settings), 'Settings')
  await instance.changeLanguage('fr')
  assert.equal(instance.resolvedLanguage, 'en')
  assert.equal(instance.t($ => $.app.title), 'Job Agent Browser')
})

test('React and isolated translation instances consume their own resource values', () => {
  const instance = createTranslationInstance()
  const other = createTranslationInstance()
  instance.addResource('en', 'translation', 'navigation.goHome', 'Return to start')
  instance.addResource('en', 'translation', 'features.notImplemented', 'Feature under construction')
  const markup = renderToStaticMarkup(createElement(I18nextProvider, { i18n: instance },
    createElement(PlaceholderPage, {
      title: 'Example', description: 'Example description',
      actions: createElement('button', { type: 'button' }, instance.t($ => $.navigation.goHome))
    })))
  assert.match(markup, />Return to start<\/button>/)
  assert.match(markup, />Feature under construction<\/p>/)
  assert.equal(other.t($ => $.navigation.goHome), 'Go home')
})

test('complete sentence interpolation preserves external titles and React renders them as text', () => {
  const instance = createTranslationInstance()
  const title = 'A & B <script>alert("x")</script> {{title}}'
  assert.equal(instance.t($ => $.browser.closeNamedTab, { title }), `Close ${title}`)
  assert.equal(instance.t($ => $.home.comingSoon, { label: 'A & B' }), 'A & B — Coming soon')
  const tab: BrowserTabState = {
    id: 'tab-1', targetId: 'target-1', title, url: 'https://example.com/',
    destination: { kind: 'web', url: 'https://example.com/' },
    canGoBack: false, canGoForward: false, isLoading: false, error: ''
  }
  const markup = renderToStaticMarkup(createElement(I18nextProvider, { i18n: instance },
    createElement(TabStrip, { tabs: [tab], activeTabId: tab.id, onCreate: () => {}, onActivate: () => {}, onClose: () => {} })))
  assert.match(markup, /aria-label="Close A &amp; B &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; \{\{title\}\}"/)
  assert.equal(markup.includes('<script>'), false)
})

// Compiled by the existing test runner; never execute invalid translation calls.
function checkTranslationTypes(): void {
  const instance = createTranslationInstance()
  // @ts-expect-error Translation keys must exist in the English catalog.
  instance.t($ => $.app.unknownKey)
}
void checkTranslationTypes
