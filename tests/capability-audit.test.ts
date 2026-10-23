import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:sqlite'
import { createToolRegistry } from '../src/shared/tools/registry'
import { createAuditedCapabilities } from '../src/platform/tools/capabilities'
import { fixture, seed, value } from './helpers'
import { caller, descriptor } from './tool-fixtures'

test('native reads audit access at the lower capability boundary, without changing ordinary query semantics', async t => {
  const f = await seed(t), registry = createToolRegistry(), before = value(await f.api.audit.list({})).total
  for (const tool of f.backend.toolCapabilities.read) registry.register(tool)
  const scope = registry.scope({ allow: ['job.get', 'profile.*'] }, caller())
  assert.equal(scope.get('job.get')?.source.type, 'native')
  const output = await scope.execute('job.get', { id: f.job.id })
  assert.equal((output.structuredContent as { title: string }).title, f.job.title)
  await scope.execute('profile.get', { id: f.profile.id })
  await scope.execute('profile.list_facts', { profileId: f.profile.id })
  const records = f.backend.toolAudit.list()
  assert.equal(records.length, 6)
  assert.equal(records[0].target_id, f.job.id)
  assert.equal(records[0].target_type, 'job')
  assert.equal(records[1].status, 'SUCCESS')
  assert.equal(records[1].mode, 'read')
  assert.equal(value(await f.api.audit.list({})).total, before)
  value(await f.api.jobs.getJob({ id: f.job.id }))
  assert.equal(f.backend.toolAudit.list().length, 6)
  for (const text of [f.job.title, f.profile.name, f.fact.content]) assert.equal(JSON.stringify(records).includes(text), false)
})

test('native write capabilities reuse the Domain transaction and preserve exactly one business change audit', async t => {
  const f = await seed(t), before = value(await f.api.audit.list({})).total
  const write = f.backend.toolCapabilities.write.setArchived
  await write.execute({ id: f.job.id, archived: true }, caller())
  assert.notEqual(value(await f.api.jobs.getJob({ id: f.job.id })).archivedAt, null)
  const changes = value(await f.api.audit.list({ targetId: f.job.id })).items.filter(entry => entry.eventType === 'JOB_ARCHIVE')
  assert.equal(changes.length, 1)
  assert.equal(value(await f.api.audit.list({})).total, before + 1)
  assert.deepEqual(f.backend.toolAudit.list().map(row => [row.phase, row.mode, row.status]), [['START', 'write', 'STARTED'], ['END', 'write', 'SUCCESS']])
})

test('failed Domain writes roll back mutation and business success audit, then capability records failure', async t => {
  const f = await seed(t), db = f.database.connection
  let denied = false
  db.setAuthorizer((action, table) => {
    if (!denied && table === 'audit_logs' && action === constants.SQLITE_INSERT) { denied = true; return constants.SQLITE_DENY }
    return constants.SQLITE_OK
  })
  await assert.rejects(f.backend.toolCapabilities.write.setArchived.execute({ id: f.job.id, archived: true }, caller()), { code: 'TOOL_EXECUTION_FAILED' })
  f.database.transactions.protectAudit()
  assert.equal(value(await f.api.jobs.getJob({ id: f.job.id })).archivedAt, null)
  assert.equal(value(await f.api.audit.list({ targetId: f.job.id })).items[0].status, 'FAILURE')
  assert.equal(f.backend.toolAudit.list()[1].status, 'FAILURE')
})

test('audit start failure prevents execution; terminal audit failure reports uncertainty without repeating writes', async t => {
  const f = fixture(t)
  let calls = 0
  const tool = f.backend.capabilities.read(descriptor(), () => { calls++; return { content: [] } })
  f.database.connection.exec('PRAGMA query_only=ON')
  await assert.rejects(tool.execute({ text: 'secret' }, caller()), { code: 'TOOL_AUDIT_UNAVAILABLE' })
  assert.equal(calls, 0)
  f.database.connection.exec('PRAGMA query_only=OFF')
  const capabilities = createAuditedCapabilities({ start: f.backend.toolAudit.sink.start, finish() { throw new Error('PRIVATE_AUDIT_PATH') } })
  const uncertain = capabilities.write({ ...descriptor('test.write'), mode: 'write', risk: 'WRITE' }, () => { calls++; return { content: [] } })
  await assert.rejects(uncertain.execute({ text: 'secret' }, caller()), { code: 'TOOL_AUDIT_UNAVAILABLE' })
  assert.equal(calls, 1)
  assert.equal(f.backend.toolAudit.list().length, 1)
  f.backend.toolAudit.recoverInterrupted()
  assert.equal(f.backend.toolAudit.list().length, 1) // A live owner's uncertain call is not a crashed call.
  f.database.connection.prepare('UPDATE runtime_instances SET expires_at=0 WHERE id=?').run(f.backend.lease.id)
  f.backend.toolAudit.recoverInterrupted()
  assert.equal(f.backend.toolAudit.list()[1].status, 'INTERRUPTED')
  f.backend.toolAudit.recoverInterrupted()
  assert.equal(f.backend.toolAudit.list().length, 2)
})

test('audit records are append-only, reject forged inserts and duplicate terminal records, and contain opaque trusted identities', t => {
  const f = fixture(t), db = f.database.connection, context = { invocationId: randomUUID(), agentId: 'resume-agent', runId: randomUUID(), tool: descriptor() }
  f.backend.toolAudit.sink.start(context)
  f.backend.toolAudit.sink.finish(context, 12, null)
  assert.throws(() => f.backend.toolAudit.sink.finish(context, 12, null), { code: 'TOOL_AUDIT_UNAVAILABLE' })
  assert.throws(() => db.exec('DELETE FROM capability_audit'))
  assert.throws(() => db.exec("UPDATE capability_audit SET agent_id='forged'"))
  assert.throws(() => db.exec('INSERT INTO capability_audit SELECT * FROM capability_audit LIMIT 1'))
  assert.equal(f.backend.toolAudit.list().length, 2)
  assert.equal(f.backend.toolAudit.list()[1].run_id, context.runId)
  assert.throws(() => f.backend.toolAudit.sink.start({ ...context, invocationId: randomUUID(), agentId: 'PRIVATE PROFILE NAME' }))
})
