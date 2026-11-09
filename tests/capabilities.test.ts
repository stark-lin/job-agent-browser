import { createAgentRecorder } from '../src/platform/electron/agent-recorder'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { consola } from 'consola'
import { createCapabilities } from '../src/platform/tools/capabilities'
import { caller, descriptor } from './tool-fixtures'
import { seed, value } from './helpers'

function reporters(t: import('node:test').TestContext, log: () => void) {
  const previous = { reporters: consola.options.reporters, level: consola.level, throttle: consola.options.throttle }
  consola.options.reporters = [{ log }]; consola.level = 5; consola.options.throttle = 0
  t.after(() => { Object.assign(consola.options, previous) })
}

test('native capabilities preserve business reads and writes with no diagnostic persistence', async t => {
  const f = await seed(t)
  const tool = f.backend.toolCapabilities.read.find(tool => tool.descriptor.name === 'job.get')!
  const result = await tool.execute({ id: f.job.id }, caller())
  assert.equal((result.structuredContent as { id: string }).id, f.job.id)
  await f.backend.toolCapabilities.write.setArchived.execute({ id: f.job.id, archived: true }, caller())
  assert(value(await f.api.jobs.getJob({ id: f.job.id })).archivedAt)
})

test('throwing reporters cannot change successful business/tool results or original failure codes', async t => {
  reporters(t, () => { throw new Error('PRIVATE_REPORTER_FAILURE') })
  const f = await seed(t), capabilities = createCapabilities({ timeoutMs: 5 })
  const tool = capabilities.read(descriptor(), () => ({ content: [], structuredContent: { accepted: true } }))
  assert.deepEqual((await tool.execute({ text: 'PRIVATE_ARGUMENT' }, caller())).structuredContent, { accepted: true })
  const timeout = capabilities.read(descriptor('test.timeout'), async () => await new Promise(() => {}))
  await assert.rejects(timeout.execute({ text: 'private' }, caller()), { code: 'TOOL_TIMEOUT' })
  f.database.connection.exec('PRAGMA query_only=ON')
  assert.deepEqual(await f.api.jobs.setArchived({ id: f.job.id, archived: true }), { ok: false, error: 'STORAGE_UNAVAILABLE' })
  f.database.connection.exec('PRAGMA query_only=OFF')
  await capabilities.dispose()
})

test('disabled diagnostics do not affect business operations', async t => {
  reporters(t, () => assert.fail('Disabled logging must not reach the reporter'))
  consola.level = -999
  const f = await seed(t)
  await f.backend.toolCapabilities.write.setArchived.execute({ id: f.job.id, archived: true }, caller())
  assert(value(await f.api.jobs.getJob({ id: f.job.id })).archivedAt)
})

test('diagnostics contain only validated names, result codes and elapsed time', async t => {
  const messages: string[] = [], previous = { reporters: consola.options.reporters, level: consola.level, throttle: consola.options.throttle }
  consola.options.reporters = [{ log: event => { messages.push(String(event.args[0])) } }]; consola.level = 5; consola.options.throttle = 0
  t.after(() => Object.assign(consola.options, previous))
  const f = await seed(t)
  await f.backend.toolCapabilities.read.find(tool => tool.descriptor.name === 'job.get')!.execute({ id: f.job.id }, caller())
  const broken = f.backend.capabilities.read(descriptor('test.broken'), () => { throw new Error('PRIVATE_EXCEPTION_STACK') })
  await assert.rejects(broken.execute({ text: 'PRIVATE_ARGUMENT' }, caller()), { code: 'TOOL_EXECUTION_FAILED' })
  assert(messages.some(message => message === '[DB] jobs.saveJob SUCCESS'))
  assert(messages.some(message => /^\[TOOL\] job.get SUCCESS \d+ms$/.test(message)))
  assert(messages.some(message => /^\[TOOL\] test.broken TOOL_EXECUTION_FAILED \d+ms$/.test(message)))
  assert(!messages.join('\n').includes('PRIVATE_'))
})

test('a failing terminal reporter cannot change persisted Agent state or emitted completion', async t => {
  reporters(t, () => { throw new Error('PRIVATE_REPORTER_FAILURE') })
  const f = await seed(t), repo = f.backend.chats
  const ids = repo.start({ requestId: randomUUID(), message: 'Private message', choice: { providerId: 'fixture', modelId: 'test' } })
  const snapshot = repo.snapshot(ids.runId), events: string[] = []
  const recorder = createAgentRecorder(repo, snapshot, event => events.push(event.type), error => { throw error })
  recorder.finish('completed', null)
  assert.equal(repo.getRun(ids.runId).state, 'completed')
  assert.equal(snapshot.run.state, 'completed')
  assert.deepEqual(events, ['run.completed'])
})
