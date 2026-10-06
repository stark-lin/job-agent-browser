import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NavigationStore } from '../src/app/navigation/navigationStore'
import { ContextStore } from '../src/app/context/contextStore'
import type { BrowserAPI, BrowserState } from '../src/shared/browser'

const state = (revision: number): BrowserState => ({ revision, tabs: [], activeTabId: '' })
const tick = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

function fixture() {
  const callbacks = new Set<(state: BrowserState) => void>()
  const reads: Array<(state: BrowserState) => void> = []
  const api: BrowserAPI = {
    getState: () => new Promise((resolve) => reads.push(resolve)),
    onStateChange: (callback) => { callbacks.add(callback); return () => { callbacks.delete(callback) } },
    onFocusAddress: () => () => {}, setVisible: async () => {}, navigate: async () => {},
    back: async () => {}, forward: async () => {}, createTab: async () => {}, activateTab: async () => {}, closeTab: async () => {}
  }
  return { store: new NavigationStore(api), callbacks, reads }
}

test('a late initial read cannot overwrite a newer state subscription', async () => {
  const { store, callbacks, reads } = fixture()
  const stop = store.start()
  for (const callback of callbacks) callback(state(5))
  reads[0](state(1)); await tick()
  assert.equal(store.getSnapshot().browser.revision, 5)
  stop(); assert.equal(callbacks.size, 0)
})

test('StrictMode restart removes old listeners and ignores stale promises after cleanup', async () => {
  const { store, callbacks, reads } = fixture()
  const stopFirst = store.start(); stopFirst()
  const stopSecond = store.start()
  assert.equal(callbacks.size, 1)
  reads[1](state(2)); await tick()
  reads[0](state(9)); await tick()
  assert.equal(store.getSnapshot().browser.revision, 2)
  stopSecond(); assert.equal(callbacks.size, 0)
})

test('action failures produce a user error and subscriptions are removable', async () => {
  const { store } = fixture()
  let changes = 0
  const unsubscribe = store.subscribe(() => { changes++ })
  await store.run(async () => { throw new Error('Unavailable') })
  assert.equal(store.getSnapshot().error?.message, 'Unavailable')
  assert.equal(changes, 2)
  unsubscribe()
  await store.run(async () => {})
  assert.equal(changes, 2); assert.equal(store.getSnapshot().error, null)
})

test('business context starts with empty references and stores IDs without entity copies', () => {
  const context = new ContextStore()
  assert.deepEqual(context.getSnapshot(), { jobId: null, profileId: null, artifactId: null })
  context.setReferences({ jobId: 'job-1' })
  assert.deepEqual(context.getSnapshot(), { jobId: 'job-1', profileId: null, artifactId: null })
})
