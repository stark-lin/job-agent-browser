import test from 'node:test'
import assert from 'node:assert/strict'
import type { BannerEvent } from '../src/shared/banner'
import { BannerService } from '../src/platform/banner/bannerService'

test('the singleton orders updates, resets the timer, and ignores expired actions', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100 })
  const service = new BannerService()
  let displayed: BannerEvent | null = null
  const detach = service.attach(event => { displayed = event })
  const event = { timeUs: service.nextTime(), title: 'Title', detail: 'Start', action: { type: 'open-ask-session' as const, sessionId: 'chat' } }
  service.publish(event)
  assert.equal(displayed, event)
  assert.equal(service.action(event.timeUs), event.action)
  t.mock.timers.tick(2000)
  const update = { ...event, detail: 'Working' }
  service.publish(update)
  service.publish({ ...event, timeUs: (BigInt(event.timeUs) - 1n).toString() })
  service.publish({ ...event, timeUs: 'invalid' })
  assert.equal(displayed, update)
  t.mock.timers.tick(4999)
  assert.equal(displayed, update)
  t.mock.timers.tick(1)
  assert.equal(displayed, null)
  service.publish(event)
  assert.equal(displayed, null)
  const next = { ...event, timeUs: service.nextTime() }
  service.publish(next)
  service.dismiss(event.timeUs)
  assert.equal(displayed, next)
  assert.equal(service.action(event.timeUs), undefined)
  service.dismiss(next.timeUs)
  service.publish(next)
  assert.equal(displayed, null)
  detach()
  assert.equal(service.action(next.timeUs), undefined)
})
