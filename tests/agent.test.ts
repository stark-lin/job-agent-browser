import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { runAgent } from '../src/platform/agent/loop'
import { compatibleAgentModel } from '../src/platform/ai/agent-model'
import type { AgentModel, AgentResponse, AgentTools } from '../src/shared/agent'
import { ToolError } from '../src/shared/tools/errors'

const signal = () => new AbortController().signal
const descriptor = (name: string) => ({ name, description: name, source: { type: 'native' as const }, tags: [], mode: 'read' as const, risk: 'READ' as const, inputSchema: { type: 'object', additionalProperties: false } })
function scope(execute: AgentTools['call'] = async () => ({})): AgentTools {
  return { list: async () => [descriptor('profile.get'), descriptor('profile_get')], call: execute }
}
function model(responses: AgentResponse[]): AgentModel { return { complete: async () => responses.shift()! } }
const call = (id: string, name = 'profile.get') => ({ id, name, arguments: {} })

test('HTTP compatible model maps colliding punctuation names and keeps complete assistant call batches before sequential results', async t => {
  const batches: unknown[] = [], audit: (string | null)[] = [], executed: string[] = []
  let turns = 0
  const server = createServer((req, res) => {
    assert.equal(req.url, '/v1/chat/completions')
    let body = ''; req.on('data', chunk => { body += chunk }); req.on('end', () => {
      const input = JSON.parse(body); batches.push(input.messages)
      assert.deepEqual(input.tools.map((tool: { function: { name: string } }) => tool.function.name), ['tool_0', 'tool_1'])
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [++turns === 1 ? { finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [
        { id: 'a', type: 'function', function: { name: 'tool_0', arguments: '{}' } }, { id: 'b', type: 'function', function: { name: 'tool_1', arguments: '{}' } }
      ] } } : { finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }] }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close())
  const adapter = compatibleAgentModel({ provider: { id: 'test', name: 'Test', baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requiresKey: false, models: ['test'], defaultModel: 'test' }, model: 'test', key: null }, { audit: (_id, error) => audit.push(error) })
  const result = await runAgent(adapter, scope(async name => { executed.push(name); await new Promise(resolve => setTimeout(resolve, 5)); return { content: [] } }), [{ role: 'user', content: 'test' }], signal())
  assert.equal(result, 'done'); assert.deepEqual(executed, ['profile.get', 'profile_get']); assert.deepEqual(audit, [null, null])
  const messages = batches[1] as { role: string; tool_calls?: unknown[] }[]
  assert.deepEqual(messages.map(message => message.role), ['user', 'assistant', 'tool', 'tool']); assert.equal(messages[1].tool_calls?.length, 2)
})
test('ordinary tool failures become observations; cancellation and audit failure terminate immediately', async () => {
  let observed = ''
  const recovering: AgentModel = { complete: async input => {
    if (input.messages.length === 1) return { content: '', toolCalls: [call('a', 'unknown')] }
    observed = JSON.stringify(input.messages); return { content: 'recovered', toolCalls: [] }
  } }
  assert.equal(await runAgent(recovering, scope(async () => { throw new ToolError('TOOL_FORBIDDEN') }), [{ role: 'user', content: 'x' }], signal()), 'recovered')
  assert(observed.includes('TOOL_FORBIDDEN'))
  await assert.rejects(runAgent(model([{ content: '', toolCalls: [call('a')] }]), scope(async () => { throw new ToolError('TOOL_AUDIT_UNAVAILABLE') }), [], signal()), /TOOL_AUDIT_UNAVAILABLE/)
  const controller = new AbortController()
  const pending = runAgent({ complete: () => new Promise(() => {}) }, scope(), [], controller.signal)
  controller.abort(); await assert.rejects(pending, /AGENT_CANCELLED/)
})
test('empty finals, repeated call IDs and 8-call exhaustion fail explicitly', async () => {
  await assert.rejects(runAgent(model([{ content: '', toolCalls: [] }]), scope(), [], signal()), /AGENT_PROTOCOL_ERROR/)
  await assert.rejects(runAgent(model([{ content: '', toolCalls: [call('a'), call('a')] }]), scope(), [], signal()), /AGENT_PROTOCOL_ERROR/)
  await assert.rejects(runAgent(model([{ content: '', toolCalls: [call('a')] }, { content: '', toolCalls: [call('a')] }]), scope(), [], signal()), /AGENT_PROTOCOL_ERROR/)
  let count = 0
  await assert.rejects(runAgent({ complete: async () => ({ content: '', toolCalls: [call(String(++count))] }) }, scope(), [], signal()), /AGENT_STEP_LIMIT/)
  assert.equal(count, 8)
})
test('adapter rejects illegal JSON arguments, protocol variants, truncation and empty output; timeout and auditing are bounded', async () => {
  const config = { provider: { id: 'test', name: 'Test', baseURL: 'http://localhost/v1', requiresKey: false, models: ['test'], defaultModel: 'test' }, model: 'test', key: null }
  const input = { messages: [], tools: [descriptor('profile.get'), descriptor('profile_get')], signal: signal() }
  for (const payload of [null, { choices: [] }, { choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'partial' } }] },
    { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }] },
    { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 'a', type: 'function', function: { name: 'tool_0', arguments: '{' } }] } }] }]) {
    const audits: unknown[] = []
    const adapter = compatibleAgentModel(config, { audit: (_id, error) => audits.push(error), transport: async () => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } }) })
    await assert.rejects(adapter.complete(input), /AGENT_PROTOCOL_ERROR/); assert.deepEqual(audits, ['AI_PROTOCOL_ERROR'])
  }
  const audits: unknown[] = []
  await assert.rejects(compatibleAgentModel(config, { audit: (_id, error) => audits.push(error), transport: () => new Promise(() => {}), timeoutMs: 10 }).complete(input), /AGENT_TIMEOUT/)
  assert.deepEqual(audits, ['AI_TIMEOUT'])
  await assert.rejects(compatibleAgentModel(config, { audit: () => { throw new Error('disk') }, transport: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }] }), { headers: { 'content-type': 'application/json' } }) }).complete(input), /AUDIT_UNAVAILABLE/)
})
