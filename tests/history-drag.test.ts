import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HistoryDrag, type HistoryFeedback } from '../src/platform/browser/historyDrag'

function fixture(width = 800) {
  let identity: string | null = 'page:1', back = true, forward = true
  const draws: (HistoryFeedback | null)[] = [], travels: number[] = []
  let clicks = 0
  const drag = new HistoryDrag({ identity: () => identity, canTravel: direction => direction === -1 ? back : forward,
    width: () => width, draw: feedback => draws.push(feedback),
    travel: direction => travels.push(direction), click: () => { clicks++ }, dismiss: () => {} })
  const mouse = (type: 'mouseDown' | 'mouseUp' | 'mouseMove', x: number, y = 100) => drag.handle({ type, button: 'right', x, y, modifiers: ['rightbuttondown'] })
  return { drag, mouse, draws, travels, clicks: () => clicks,
    identify: (value: string | null) => { identity = value }, boundary: () => { back = false; forward = false } }
}

test('right drags show direction/readiness, commit once on release and preserve ordinary clicks', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const f = fixture()
  f.mouse('mouseDown', 200); assert(f.mouse('mouseMove', 240))
  assert.deepEqual(f.draws.at(-1), { direction: -1, available: true, ready: false })
  f.mouse('mouseMove', 350)
  assert.deepEqual(f.draws.at(-1), { direction: -1, available: true, ready: true })
  assert.deepEqual(f.travels, [])
  assert(f.mouse('mouseUp', 350))
  assert.deepEqual(f.travels, [-1]); assert.equal(f.draws.at(-1), null)
  assert.equal(f.drag.active, false)
  t.mock.timers.tick(400)
  f.mouse('mouseDown', 200); assert.equal(f.mouse('mouseUp', 200), false)
  assert.equal(f.clicks(), 1)
  f.mouse('mouseDown', 400); f.mouse('mouseMove', 250)
  assert.deepEqual(f.draws.at(-1), { direction: 1, available: true, ready: true })
  f.mouse('mouseUp', 250)
  assert.deepEqual(f.travels, [-1, 1])
})

test('short/reversed gestures hide the arrow immediately; vertical drags do not navigate', () => {
  const f = fixture()
  f.mouse('mouseDown', 100); f.mouse('mouseMove', 140); f.mouse('mouseUp', 140)
  assert.deepEqual(f.travels, []); assert.equal(f.draws.at(-1), null)
  f.mouse('mouseDown', 100); f.mouse('mouseMove', 300); f.mouse('mouseMove', 110)
  assert.deepEqual(f.draws.at(-1), { direction: -1, available: true, ready: false })
  f.mouse('mouseMove', 80)
  assert.deepEqual(f.draws.at(-1), { direction: 1, available: true, ready: false })
  f.mouse('mouseUp', 100)
  assert.deepEqual(f.travels, []); assert.equal(f.draws.at(-1), null)
  f.mouse('mouseDown', 100); assert.equal(f.mouse('mouseMove', 110, 300), false); f.mouse('mouseUp', 300, 300)
  assert.deepEqual(f.travels, [])
})

test('wheel strokes share arrow feedback, reverse to cancel and suppress tail events', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const f = fixture()
  f.drag.wheel(80)
  assert.deepEqual(f.draws.at(-1), { direction: -1, available: true, ready: false })
  f.drag.wheel(40)
  assert.deepEqual(f.draws.at(-1), { direction: -1, available: true, ready: true })
  f.drag.endWheel(); f.drag.endWheel(); f.drag.wheel(500)
  assert.deepEqual(f.travels, [-1]); assert.equal(f.draws.at(-1), null)
  t.mock.timers.tick(400)
  f.drag.wheel(-120); f.drag.wheel(100); f.drag.endWheel()
  assert.deepEqual(f.travels, [-1]); assert.equal(f.draws.at(-1), null)
})

test('unavailable directions never arm; identity changes and cancellation dismiss feedback', () => {
  const f = fixture()
  f.boundary(); f.drag.wheel(500)
  assert.deepEqual(f.draws.at(-1), { direction: -1, available: false, ready: false })
  f.drag.endWheel(); assert.deepEqual(f.travels, []); assert.equal(f.draws.at(-1), null)
  const g = fixture()
  g.drag.wheel(-200); g.identify('other-tab'); g.drag.endWheel()
  assert.deepEqual(g.travels, []); assert.equal(g.draws.at(-1), null)
  g.identify(null); g.drag.wheel(200); g.drag.endWheel(); assert.deepEqual(g.travels, [])
  g.identify('page:2'); g.drag.wheel(200); g.drag.cancel(); g.drag.endWheel()
  assert.deepEqual(g.travels, []); assert.equal(g.draws.at(-1), null)
})

test('narrow viewports use the same reduced threshold for arrow readiness and navigation', () => {
  const f = fixture(320)
  f.drag.wheel(79); assert.equal(f.draws.at(-1)?.ready, false)
  f.drag.wheel(1); assert.equal(f.draws.at(-1)?.ready, true)
  f.drag.endWheel(); assert.deepEqual(f.travels, [-1])
})
