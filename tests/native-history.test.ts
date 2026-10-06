import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NativeHistoryIdentity } from '../src/platform/browser/nativeHistory'

function fixture() {
  const replies: Array<(response: unknown) => void> = []
  let destroyed = false
  const identity = new NativeHistoryIdentity({
    isDestroyed: () => destroyed,
    debugger: {
      attach: (version) => { assert.equal(version, '1.3') },
      sendCommand: (method) => {
        assert.equal(method, 'Page.getNavigationHistory')
        return new Promise((resolve) => replies.push(resolve))
      }
    }
  })
  return { identity, replies, destroy: () => { destroyed = true } }
}
const snapshot = (ids: number[], currentIndex: number) => ({ currentIndex, entries: ids.map((id) => ({ id, url: 'https://same.example/' })) })

test('same-URL visits use native IDs, while website traversal and replacement preserve app future', async () => {
  const { identity, replies } = fixture()
  const initial = identity.committed(); replies[0](snapshot([1, 2, 3], 2)); assert.equal(await initial, true)
  const back = identity.committed(); replies[1](snapshot([1, 2, 3], 1)); assert.equal(await back, false)
  const forward = identity.committed(); replies[2](snapshot([1, 2, 3], 2)); assert.equal(await forward, false)
  const replace = identity.committed(); replies[3](snapshot([1, 2, 3], 2)); assert.equal(await replace, false)
  const branch = identity.committed(); replies[4](snapshot([1, 2, 4], 2)); assert.equal(await branch, true)
})

test('out-of-order observations ignore older replies without losing the accepted identity', async () => {
  const { identity, replies } = fixture()
  const older = identity.committed(), newer = identity.committed()
  replies[1](snapshot([1, 2], 1)); assert.equal(await newer, true)
  replies[0](snapshot([1], 0)); assert.equal(await older, false)
  const traversal = identity.committed(); replies[2](snapshot([1, 2], 0)); assert.equal(await traversal, false)
})

test('destroyed views ignore pending history observations', async () => {
  const { identity, replies, destroy } = fixture()
  const pending = identity.committed(); destroy(); replies[0](snapshot([1], 0))
  assert.equal(await pending, false)
})

test('invalid native snapshots are rejected instead of guessing identity from URLs', async () => {
  const { identity, replies } = fixture()
  const pending = identity.committed(); replies[0]({ currentIndex: 0, entries: [{ url: 'https://same.example/' }] })
  await assert.rejects(pending, /Invalid native history entry/)
})
