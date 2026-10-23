import test from 'node:test'
import assert from 'node:assert/strict'
import { createToolRegistry } from '../src/shared/tools/registry'
import { createAuditedCapabilities } from '../src/platform/tools/capabilities'
import { compileSchema, jsonCopy, limits } from '../src/platform/tools/schema'
import { fixture } from './helpers'
import { caller, descriptor, inputSchema } from './tool-fixtures'

test('registry descriptors cannot execute or mutate tools; duplicates and trusted operations are rejected', async t => {
  const f = fixture(t), registry = createToolRegistry(), capabilities = f.backend.capabilities
  const tool = capabilities.read(descriptor(), () => ({ content: [], structuredContent: { accepted: true } }))
  registry.register(tool)
  assert.equal('execute' in registry.get('test.echo')!, false)
  assert.throws(() => { registry.get('test.echo')!.inputSchema.type = 'string' }, TypeError)
  assert.throws(() => registry.register(tool), { code: 'TOOL_CONFLICT' })
  for (const name of ['audit.write', 'database.raw_query', 'generation.publish', 'transaction.begin', 'secret.read']) {
    assert.throws(() => registry.register({ ...tool, descriptor: { ...tool.descriptor, name } }), { code: 'TOOL_INVALID_CONFIG' })
  }
  registry.unregister('test.echo')
  assert.equal(registry.get('test.echo'), null)
})

test('scope is deny-by-default, denies take priority, and only exact or namespace suffix patterns work', async t => {
  const f = fixture(t), registry = createToolRegistry()
  for (const [name, risk] of [['test.echo', 'READ'], ['test.compute', 'COMPUTE'], ['test.modify', 'WRITE']] as const) {
    const tool = { ...descriptor(name), risk, mode: risk === 'WRITE' ? 'write' as const : 'read' as const }
    registry.register(f.backend.capabilities[tool.mode](tool, () => ({ content: [] })))
  }
  assert.deepEqual(registry.scope({ allow: [] }, caller()).list(), [])
  const scope = registry.scope({ allow: ['test.*'], deny: ['test.echo'], maxRisk: 'COMPUTE' }, caller())
  assert.deepEqual(scope.list().map(tool => tool.name), ['test.compute'])
  await assert.rejects(scope.execute('test.echo', { text: 'private' }), { code: 'TOOL_FORBIDDEN' })
  await assert.rejects(scope.execute('test.modify', { text: 'private' }), { code: 'TOOL_FORBIDDEN' })
  for (const pattern of ['*', '*.delete', 'test.*.read', 'test*']) assert.throws(() => registry.scope({ allow: [pattern] }, caller()), { code: 'TOOL_INVALID_CONFIG' })
  assert.equal(f.backend.toolAudit.list().length, 0)
})

test('scope freezes permissions and caller identity, and revocation cancels active calls without rebinding stale scopes', async t => {
  const f = fixture(t), registry = createToolRegistry(), identity = caller(), policy = { allow: ['test.*'] }
  let started!: () => void
  const began = new Promise<void>(resolve => { started = resolve })
  registry.register(f.backend.capabilities.read(descriptor(), async () => { started(); return await new Promise(() => {}) }))
  const scope = registry.scope(policy, identity)
  policy.allow[0] = 'other.*'; identity.agentId = 'forged'
  const pending = scope.execute('test.echo', { text: 'PRIVATE_TOKEN' })
  await began
  registry.unregister('test.echo')
  await assert.rejects(pending, { code: 'TOOL_UNAVAILABLE' })
  registry.register(f.backend.capabilities.read(descriptor(), () => ({ content: [] })))
  registry.register(f.backend.capabilities.read(descriptor('test.new'), () => ({ content: [] })))
  assert.deepEqual(scope.list(), [])
  await assert.rejects(scope.execute('test.echo', { text: 'private' }), { code: 'TOOL_UNAVAILABLE' })
  await assert.rejects(scope.execute('test.new', { text: 'private' }), { code: 'TOOL_FORBIDDEN' })
  assert.equal(f.backend.toolAudit.list()[0].agent_id, 'test-agent')
  assert.equal(JSON.stringify(f.backend.toolAudit.list()).includes('PRIVATE_TOKEN'), false)
})

test('lower read/write capabilities validate both boundaries, preserve inputs and redact raw errors', async t => {
  const f = fixture(t), context = caller()
  let calls = 0
  const tool = f.backend.capabilities.read({ ...descriptor(), outputSchema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false } },
    () => { calls++; return { content: [], structuredContent: { count: 'wrong' } } })
  await assert.rejects(tool.execute({ text: 42 }, context), { code: 'TOOL_INVALID_INPUT' })
  assert.equal(calls, 0)
  await assert.rejects(tool.execute({ text: 'secret' }, context), { code: 'TOOL_INVALID_OUTPUT' })
  assert.equal(calls, 1)
  const broken = f.backend.capabilities.read(descriptor('test.broken'), () => { throw new Error('PRIVATE_PROCESS_PATH_TOKEN') })
  await assert.rejects(broken.execute({ text: 'secret' }, context), error => {
    assert.equal((error as Error).message, 'TOOL_EXECUTION_FAILED'); return true
  })
  assert.equal(JSON.stringify(f.backend.toolAudit.list()).includes('PRIVATE_PROCESS_PATH_TOKEN'), false)
  assert.throws(() => f.backend.capabilities.write(descriptor(), () => ({ content: [] })), { code: 'TOOL_INVALID_CONFIG' })
})

test('JSON boundaries reject external references, schema dialects, coercion, getters and oversized results', async t => {
  const f = fixture(t)
  for (const schema of [{ type: 'object', $ref: 'https://example.com/schema' }, { type: 'object', $schema: 'http://json-schema.org/draft-07/schema#' },
    { type: 'object', $dynamicRef: '#thing' }]) assert.throws(() => compileSchema(schema, true), { code: 'TOOL_INVALID_CONFIG' })
  let touched = false
  assert.throws(() => jsonCopy({ get token() { touched = true; return 'secret' } }, 100, 'TOOL_INVALID_INPUT'))
  assert.equal(touched, false)
  assert.throws(() => jsonCopy({ text: undefined }, 100, 'TOOL_INVALID_INPUT'))
  const tool = f.backend.capabilities.read(descriptor(), () => ({ content: [{ type: 'text', text: 'x'.repeat(limits.output) }] }))
  await assert.rejects(tool.execute({ text: 'test' }, caller()), { code: 'TOOL_INVALID_OUTPUT' })
})

test('timeout and cancellation finish once even when an underlying operation ignores the signal', async t => {
  const f = fixture(t), capabilities = createAuditedCapabilities(f.backend.toolAudit.sink, { timeoutMs: 10 })
  const tool = capabilities.read(descriptor(), async () => await new Promise(() => {}))
  await assert.rejects(tool.execute({ text: 'private' }, caller()), { code: 'TOOL_TIMEOUT' })
  const cancelled = new AbortController(), pending = tool.execute({ text: 'private' }, { agentId: 'test-agent', signal: cancelled.signal })
  cancelled.abort()
  await assert.rejects(pending, { code: 'TOOL_CANCELLED' })
  assert.deepEqual(f.backend.toolAudit.list().filter(row => row.phase === 'END').map(row => row.error), ['TOOL_TIMEOUT', 'TOOL_CANCELLED'])
  await capabilities.dispose()
  await assert.rejects(tool.execute({ text: 'private' }, caller()), { code: 'TOOL_UNAVAILABLE' })
})

test('capability concurrency is bounded, scope disposal cancels work, and descriptors retain approved schemas', async t => {
  const f = fixture(t), capabilities = createAuditedCapabilities(f.backend.toolAudit.sink, { maxActive: 1 }), registry = createToolRegistry()
  const tool = capabilities.read(descriptor(), async () => await new Promise(() => {}))
  registry.register(tool)
  const scope = registry.scope({ allow: ['test.echo'] }, caller()), pending = scope.execute('test.echo', { text: 'test' })
  await assert.rejects(tool.execute({ text: 'test' }, caller()), { code: 'TOOL_BUSY' })
  scope.dispose()
  await assert.rejects(pending, { code: 'TOOL_CANCELLED' })
  await assert.rejects(scope.execute('test.echo', { text: 'test' }), { code: 'TOOL_CANCELLED' })
  assert.deepEqual(tool.descriptor.inputSchema, inputSchema)
  await capabilities.dispose()
})

test('server replacement validates the whole batch atomically and never overwrites another capability', async t => {
  const f = fixture(t), registry = createToolRegistry()
  const make = (name: string) => f.backend.capabilities.read({ ...descriptor(name), source: { type: 'mcp', serverId: 'fixture', originalName: 'echo' } }, () => ({ content: [] }))
  registry.register(make('fixture.echo'))
  const scope = registry.scope({ allow: ['fixture.echo'] }, caller())
  assert.throws(() => registry.replaceServer('fixture', [make('fixture.new'), make('fixture.new')]), { code: 'TOOL_CONFLICT' })
  await scope.execute('fixture.echo', { text: 'still registered' })
  const native = f.backend.capabilities.read(descriptor('fixture.native'), () => ({ content: [] }))
  registry.register(native)
  assert.throws(() => registry.replaceServer('fixture', [make('fixture.native')]), { code: 'TOOL_CONFLICT' })
  assert.equal(registry.get('fixture.native')?.source.type, 'native')
  registry.replaceServer('fixture', [make('fixture.echo')])
  assert.equal(scope.get('fixture.echo'), null)
  assert.throws(() => { native.descriptor.source.type = 'mcp' }, TypeError)
})

test('capability disposal settles audit before resolving even when underlying work ignores cancellation', async t => {
  const f = fixture(t), capabilities = createAuditedCapabilities(f.backend.toolAudit.sink)
  const pending = capabilities.read(descriptor(), async () => await new Promise(() => {})).execute({ text: 'private' }, caller())
  const rejected = assert.rejects(pending, { code: 'TOOL_CANCELLED' })
  await capabilities.dispose(); await rejected
  assert.deepEqual(f.backend.toolAudit.list().map(row => row.phase), ['START', 'END'])
  assert.equal(f.backend.toolAudit.list()[1].error, 'TOOL_CANCELLED')
})
