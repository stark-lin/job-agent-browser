import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createChatDebugService } from '../src/domain/chat/chat-debug.service'
import { fail } from '../src/domain/common/errors'
import type { ChatDebugData } from '../src/domain/chat/chat-debug.types'

test('copy use case validates strictly before IO, requires output before reading, and propagates fixed failures', async () => {
  const sessionId = randomUUID(), bundle = {} as ChatDebugData, calls: string[] = []
  const repo = { getDebugBundle(id: string) { calls.push(id); return bundle } }
  const service = createChatDebugService(repo, { async copy(data) { assert.equal(data, bundle); calls.push('copy'); return null } })
  for (const input of [null, {}, [], { sessionId: 'bad' }, { sessionId, extra: true }]) await assert.rejects(() => service.copyDebugJson(input), { code: 'INVALID_INPUT' })
  await assert.rejects(() => createChatDebugService(repo).copyDebugJson({ sessionId }), { code: 'NOT_IMPLEMENTED' })
  assert.deepEqual(calls, [])
  assert.equal(await service.copyDebugJson({ sessionId }), null); assert.deepEqual(calls, [sessionId, 'copy'])
  await assert.rejects(() => createChatDebugService({ getDebugBundle() { fail('STORAGE_BUSY') } }, { async copy() { assert.fail('must not copy') } }).copyDebugJson({ sessionId }), { code: 'STORAGE_BUSY' })
})
