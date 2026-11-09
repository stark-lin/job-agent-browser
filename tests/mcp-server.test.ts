import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { firstPartyFixture } from './first-party-fixture'
import { createExternalRun } from '../src/platform/mcp/external-run'
import { createMCPServer } from '../src/platform/mcp-server/server'
import { createJobAgentTooling, jobAgentAllowlist } from '../src/platform/tools'
import { until } from './tool-fixtures'

test('protocol adapter lists only the allowlist, preserves schemas, sanitizes errors and propagates request cancellation', async t => {
  const f = await firstPartyFixture(t), controller = new AbortController()
  let building = false, cancelled = false
  const tooling = createJobAgentTooling(f.backend, async (_id, signal) => {
    building = true
    await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve() }, { once: true }))
    return {}
  })
  const runtime = createMCPServer(tooling.registry, { allow: jobAgentAllowlist, maxRisk: 'WRITE' }, controller.signal, undefined, undefined, undefined, createExternalRun(f.directory))
  const [a, b] = InMemoryTransport.createLinkedPair(), client = new Client({ name: 'test', version: '1' })
  t.after(async () => { controller.abort(); await client.close(); await runtime.dispose(); tooling.dispose() })
  await runtime.server.connect(b); await client.connect(a)
  const listed = (await client.listTools()).tools
  assert.deepEqual(listed.map(tool => tool.name).sort(), [...jobAgentAllowlist, 'run.begin', 'run.end'].sort())
  for (const tool of listed.filter(tool => !tool.name.startsWith('run.'))) {
    const { executionRunId: _execution, ...properties } = tool.inputSchema.properties!
    assert.deepEqual({ ...tool.inputSchema, properties, required: tool.inputSchema.required!.filter(key => key !== 'executionRunId') }, { ...tooling.registry.get(tool.name)!.inputSchema, required: (tooling.registry.get(tool.name)!.inputSchema as { required?: string[] }).required ?? [] })
  }
  const begin = async () => ((await client.callTool({ name: 'run.begin', arguments: {} })).structuredContent as { runId: string }).runId
  let executionRunId = await begin()
  const forbidden = await client.callTool({ name: 'company.delete', arguments: { executionRunId, id: f.job.id, archived: true } })
  assert.equal(forbidden.isError, true); assert.equal(forbidden.content[0].type === 'text' && forbidden.content[0].text, 'TOOL_FORBIDDEN')
  const invalid = await client.callTool({ name: 'resume.publish', arguments: { executionRunId, runId: 'PRIVATE_INVALID_ID' } })
  assert.equal(invalid.isError, true); assert(!JSON.stringify(invalid).includes('PRIVATE_INVALID_ID'))
  const cancel = new AbortController()
  const pending = client.callTool({ name: 'artifact.build', arguments: { executionRunId, artifactId: f.fact.id } }, { signal: cancel.signal })
  await until(() => building); cancel.abort(); await assert.rejects(pending); await until(() => cancelled)
  await client.callTool({ name: 'run.end', arguments: { runId: executionRunId } })
  executionRunId = await begin()
  const result = await client.callTool({ name: 'job.list', arguments: { executionRunId } })
  assert.equal(result.isError, undefined); assert.equal(result.content[0].type, 'text')
})
