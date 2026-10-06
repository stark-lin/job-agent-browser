import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MixedHistory, type HistoryItem, type HistorySegment } from '../src/platform/browser/mixedHistory'
import { resolveDestination } from '../src/platform/browser/navigationManager'
import { internalPages, isBrowserDestination, type InternalPage } from '../src/shared/navigation'

class FakeSegment implements HistorySegment {
  index = 0
  disposed = false
  moves: number[] = []
  constructor(readonly id: string, public length: number) { this.index = length - 1 }
  move(index: number): void { this.moves.push(index); this.index = index }
  trimForward(): void { this.length = this.index + 1 }
  dispose(): void { this.disposed = true }
}
const internal = (page: InternalPage, id: string = page): HistoryItem<FakeSegment> => ({ kind: 'internal', id, destination: { kind: 'internal', page } })
const web = (segment: FakeSegment): HistoryItem<FakeSegment> => ({ kind: 'web', id: segment.id, segment })

for (const page of Object.keys(internalPages) as InternalPage[]) {
  test(`internal route ${page} resolves without exposing it as a web destination`, () => {
    assert.deepEqual(resolveDestination(`app://${page}`), { kind: 'internal', page })
    assert.equal(isBrowserDestination(resolveDestination(`app://${page}`)), page === 'browser')
  })
}
for (const input of ['app://missing', 'app://home/other', 'app://home?x=1', 'app://home#fragment', 'app://user@home', 'app://home:80']) {
  test(`unknown internal target is rejected: ${input}`, () => assert.throws(() => resolveDestination(input)))
}

test('crosses Home, feature pages and native segments in both directions without appending during traversal', () => {
  const history = new MixedHistory<FakeSegment>(), a = new FakeSegment('a', 2), c = new FakeSegment('c', 1)
  history.append(internal('home'))
  history.append(internal('find'))
  history.append(web(a))
  history.append(internal('resume'))
  history.append(web(c))
  for (const expected of ['resume', 'a', 'a', 'find', 'home']) {
    history.travel(-1); assert.equal(history.current.id, expected)
  }
  assert.equal(history.canGoBack, false)
  assert.equal(a.index, 0)
  for (const expected of ['find', 'a', 'a', 'resume', 'c']) {
    history.travel(1); assert.equal(history.current.id, expected)
  }
  assert.equal(history.canGoForward, false)
  assert.equal(history.items.length, 5)
  assert.equal(a.disposed, false)
})

test('branching trims native forward entries and disposes unreachable web segments', () => {
  const history = new MixedHistory<FakeSegment>(), a = new FakeSegment('a', 3), c = new FakeSegment('c', 1)
  history.append(internal('home')); history.append(web(a)); history.append(internal('profile')); history.append(web(c))
  history.travel(-1); history.travel(-1); history.travel(-1)
  assert.equal(a.index, 1)
  history.append(internal('settings'))
  assert.equal(a.length, 2)
  assert.equal(c.disposed, true)
  assert.deepEqual(history.items.map((item) => item.id), ['home', 'a', 'settings'])
  assert.equal(history.canGoForward, false)
})

test('native new-entry pruning preserves current segment, and duplicate internal targets keep separate identities', () => {
  const history = new MixedHistory<FakeSegment>(), segment = new FakeSegment('a', 1)
  history.append(internal('home')); history.append(web(segment)); history.append(internal('home', 'home-2'))
  history.travel(-1); history.discardFuture()
  assert.equal(history.current.id, 'a'); assert.equal(segment.disposed, false)
  history.append(internal('home', 'home-3')); history.append(internal('home', 'home-4'))
  history.travel(-1); assert.equal(history.current.id, 'home-3')
  history.dispose(); assert.equal(segment.disposed, true)
})

test('independent histories never affect other tabs and failed first web load can return to Home', () => {
  const first = new MixedHistory<FakeSegment>(), second = new MixedHistory<FakeSegment>()
  first.append(internal('home')); second.append(internal('home'))
  first.append(web(new FakeSegment('failure', 1)))
  assert.equal(second.canGoBack, false)
  first.travel(-1); assert.equal(first.current.id, 'home'); assert.equal(first.canGoForward, true)
})
