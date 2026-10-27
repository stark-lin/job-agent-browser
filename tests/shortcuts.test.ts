import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { installShortcuts } from '../src/platform/browser/shortcuts'

for (const platform of ['win32', 'linux', 'darwin'] as const) {
  test(`${platform}: Ctrl+Tab cycles in both directions without being swallowed by command shortcuts`, () => {
    const contents = new EventEmitter(), called: string[] = []
    const actions = { back: () => called.push('back'), forward: () => called.push('forward'),
      createTab: () => called.push('create'), closeActive: () => called.push('close'),
      focusAddress: () => called.push('address'), cycle: (direction: -1 | 1) => called.push('cycle:' + direction) }
    installShortcuts(contents as unknown as WebContents, actions, platform)
    const send = (key: string, modifiers: { control?: boolean; meta?: boolean; shift?: boolean; alt?: boolean }, type = 'keyDown') => {
      let prevented = false
      contents.emit('before-input-event', { preventDefault: () => { prevented = true } },
        { type, key, control: false, meta: false, shift: false, alt: false, ...modifiers })
      return prevented
    }
    assert(send('Tab', { control: true }))
    assert(send('Tab', { control: true, shift: true }))
    assert.deepEqual(called, ['cycle:1', 'cycle:-1'])
    assert(!send('Tab', {}))
    assert(!send('Tab', { control: true, alt: true }))
    assert(!send('Tab', { control: true }, 'keyUp'))
    const command = platform === 'darwin' ? { meta: true } : { control: true }
    assert(send('T', command)); assert(send('W', command)); assert(send('L', command))
    assert.deepEqual(called.slice(2), ['create', 'close', 'address'])
  })
}
