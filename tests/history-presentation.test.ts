import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HistoryPresentation } from '../src/platform/browser/historyPresentation'

function fixture() {
  const visibility: boolean[] = [], frames: Array<() => void> = []
  const presentation = new HistoryPresentation(value => visibility.push(value), () => new Promise(resolve => frames.push(resolve)))
  return { presentation, visibility, frames }
}

test('history stays covered until the target compositor frame is ready', async () => {
  const { presentation, visibility, frames } = fixture()
  presentation.begin()
  const ready = presentation.ready()
  assert.equal(presentation.pending, true)
  assert.deepEqual(visibility, [true])
  frames[0](); await ready
  assert.equal(presentation.pending, false)
  assert.deepEqual(visibility, [true, false])
})

test('a superseded frame cannot uncover a newer history target', async () => {
  const { presentation, visibility, frames } = fixture()
  presentation.begin(); const first = presentation.ready()
  presentation.begin(); const second = presentation.ready()
  frames[0](); await first
  assert(presentation.pending)
  assert.deepEqual(visibility, [true, true])
  frames[1](); await second
  assert.deepEqual(visibility, [true, true, false])
})

test('closed views ignore pending readiness, while failed loads remain recoverable', async () => {
  const { presentation, visibility, frames } = fixture()
  presentation.begin(); const ready = presentation.ready()
  presentation.dispose(); frames[0](); await ready
  assert.deepEqual(visibility, [true])
  const errors: boolean[] = []
  const failed = new HistoryPresentation(value => errors.push(value), async () => { throw new Error('Navigation failed') })
  failed.begin(); await failed.ready()
  assert.deepEqual(errors, [true, false])
  assert.equal(failed.pending, false)
})
