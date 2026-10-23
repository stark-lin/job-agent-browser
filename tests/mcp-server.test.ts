import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { seed } from './helpers'
import { createMCPServer } from '../src/platform/mcp-server/server'
import { createResumeTooling, resumeAllowlist } from '../src/platform/tools/resume'
import { until } from './tool-fixtures'

test('protocol adapter lists only the allowlist, preserves schemas, sanitizes errors and propagates request cancellation', async t => {
  const f = await seed(t), controller = new AbortController()
  let building = false, cancelled = false
  const tooling = createResumeTooling(f.backend, async (_id, signal) => {
    building = true
    await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve() }, { once: true }))
    return {}
  })
  const runtime = createMCPServer(tooling.registry, { allow: resumeAllowlist, maxRisk: 'WRITE' }, controller.signal)
  const [a, b] = InMemoryTransport.createLinkedPair(), client = new Client({ name: 'test', version: '1' })
  t.after(async () => { controller.abort(); await client.close(); await runtime.dispose(); tooling.dispose() })
  await runtime.server.connect(b); await client.connect(a)
  const listed = (await client.listTools()).tools
  assert.deepEqual(listed.map(tool => tool.name).sort(), [...resumeAllowlist].sort())
  for (const tool of listed) assert.deepEqual(tool.inputSchema, tooling.registry.get(tool.name)!.inputSchema)
  const forbidden = await client.callTool({ name: 'job.set_archived', arguments: { id: f.job.id, archived: true } })
  assert.equal(forbidden.isError, true); assert.equal(forbidden.content[0].type === 'text' && forbidden.content[0].text, 'TOOL_FORBIDDEN')
  const invalid = await client.callTool({ name: 'resume.publish', arguments: { runId: 'PRIVATE_INVALID_ID' } })
  assert.equal(invalid.isError, true); assert(!JSON.stringify(invalid).includes('PRIVATE_INVALID_ID'))
  const cancel = new AbortController()
  const pending = client.callTool({ name: 'artifact.build', arguments: { artifactId: f.fact.id } }, { signal: cancel.signal })
  await until(() => building); cancel.abort(); await assert.rejects(pending); await until(() => cancelled)
  const result = await client.callTool({ name: 'job.list', arguments: {} })
  assert.equal(result.isError, undefined); assert.equal(result.content[0].type, 'text')
})
