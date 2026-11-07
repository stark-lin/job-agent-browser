import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TabNavigation, type NavigationItem, type HistorySegment } from '../src/platform/browser/tabNavigation'
import { resolveDestination } from '../src/platform/browser/navigationManager'
import { internalPages, isBrowserDestination, isInboxDestination, type InternalPage } from '../src/shared/navigation'

class FakeSegment implements HistorySegment {
  index = 0
  disposed = false
  moves: number[] = []
  constructor(readonly id: string, public length: number, readonly surface: 'browser' | 'inbox' = 'browser') { this.index = length - 1 }
  move(index: number): void { this.moves.push(index); this.index = index }
  trimForward(): void { this.length = this.index + 1 }
  dispose(): void { this.disposed = true }
}
const internal = (page: InternalPage, id: string = page): Extract<NavigationItem<FakeSegment>, { kind: 'internal' }> => ({ kind: 'internal', id, destination: { kind: 'internal', page } })

for (const page of Object.keys(internalPages) as InternalPage[]) {
  test(`internal route ${page} resolves without exposing it as a web destination`, () => {
    assert.deepEqual(resolveDestination(`app://${page}`), { kind: 'internal', page })
    assert.equal(isBrowserDestination(resolveDestination(`app://${page}`)), page === 'browser')
  })
}
for (const input of ['app://missing', 'app://home', 'app://ai/other', 'app://ai?x=1', 'app://ai#fragment', 'app://user@ai', 'app://ai:80']) {
  test(`unknown internal target is rejected: ${input}`, () => assert.throws(() => resolveDestination(input)))
}

test('webmail surface stays distinct from the Browser even at the same URL', () => {
  const url = 'https://mail.example.com/'
  assert.equal(isBrowserDestination({ kind: 'web', url }), true)
  assert.equal(isInboxDestination({ kind: 'web', url }), false)
  assert.equal(isBrowserDestination({ kind: 'web', url, surface: 'inbox' }), false)
  assert.equal(isInboxDestination({ kind: 'web', url, surface: 'inbox' }), true)
})

test('workspace navigation preserves the browser position and forward history', () => {
  const navigation = new TabNavigation<FakeSegment>(internal('ai')), browser = new FakeSegment('browser', 3)
  navigation.showWeb(browser)
  navigation.travel(-1)
  assert.equal(browser.index, 1)
  for (const page of ['ai', 'find', 'resume', 'profile', 'settings'] as const) {
    navigation.showPage(internal(page))
    assert.equal(navigation.canGoBack, false)
    assert.equal(navigation.canGoForward, false)
    navigation.travel(-1); navigation.travel(1)
    assert.equal(navigation.current.id, page)
    assert.equal(browser.index, 1)
    assert.equal(browser.length, 3)
  }
  navigation.showPage(internal('browser'))
  assert.equal(navigation.current.id, browser.id)
  assert.equal(navigation.canGoForward, true)
  navigation.travel(1)
  assert.equal(browser.index, 2)
  navigation.travel(1)
  assert.equal(browser.index, 2)
  navigation.travel(-1); navigation.travel(-1); navigation.travel(-1)
  assert.equal(browser.index, 0)
  assert.equal(navigation.current.id, browser.id)
  assert.equal(navigation.canGoBack, false)
})

test('Inbox retains a separate surface and cannot be traversed by Browser controls', () => {
  const navigation = new TabNavigation<FakeSegment>(internal('browser'))
  const browser = new FakeSegment('browser', 2), inbox = new FakeSegment('inbox', 3, 'inbox')
  navigation.showWeb(browser); navigation.travel(-1)
  navigation.showWeb(inbox)
  navigation.travel(-1); navigation.travel(1)
  assert.equal(inbox.index, 2)
  assert.equal(navigation.canGoBack, false)
  assert.equal(navigation.canGoForward, false)
  navigation.showPage(internal('browser'))
  assert.equal(navigation.current.id, browser.id)
  assert.equal(browser.index, 0)
  assert.equal(navigation.canGoForward, true)
  assert.equal(navigation.segment('inbox'), inbox)
  assert.equal(navigation.items.length, 2)
  navigation.dispose()
  assert(browser.disposed); assert(inbox.disposed)
})

test('empty, first-load and independent tabs never travel into workspace pages', () => {
  const first = new TabNavigation<FakeSegment>(internal('browser'))
  const second = new TabNavigation<FakeSegment>(internal('ai'))
  first.travel(-1); first.travel(1)
  assert.equal(first.current.id, 'browser')
  first.showWeb(new FakeSegment('first-page', 1))
  first.travel(-1)
  assert.equal(first.current.id, 'first-page')
  assert.equal(first.canGoBack, false)
  assert.equal(second.current.id, 'ai')
  assert.equal(second.items.length, 0)
})
