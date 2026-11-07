import test from 'node:test'
import assert from 'node:assert/strict'
import { completeAgentText } from '../src/platform/agent/model-completion'
import { compatibleAgentModel } from '../src/platform/ai/agent-model'

const signal = () => new AbortController().signal
const descriptor = (name: string) => ({ name, description: name, inputSchema: { type: 'object', additionalProperties: false } })

test('one-shot completion has no tools and rejects unexpected calls', async () => {
  const input = [{ role: 'user' as const, content: 'parse this' }]
  assert.equal(await completeAgentText({ complete: async args => {
    assert.deepEqual(args.tools, []); assert.deepEqual(args.messages, input)
    return { content: 'done', toolCalls: [] }
  } }, input, signal()), 'done')
  await assert.rejects(completeAgentText({ complete: async () => ({ content: '', toolCalls: [{ id: 'a', name: 'job.list', arguments: {} }] }) }, input, signal()), /AGENT_PROTOCOL_ERROR/)
  const controller = new AbortController()
  const pending = completeAgentText({ complete: () => new Promise(() => {}) }, input, controller.signal)
  controller.abort()
  await assert.rejects(pending, /AGENT_CANCELLED/)
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
