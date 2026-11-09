import type { AgentToolCall, AgentRuntimeEvent, AgentToolDescriptor, AgentTools, StreamingAgentModel } from '../src/shared/agent'
import { compatibleAgentModel } from '../src/platform/ai/agent-model'
import { stableName } from '../src/platform/ai/agent-protocol'
import { ContextBudget } from '../src/platform/agent/context/budget'
import { ContextManager } from '../src/platform/agent/context/manager'
import { runPiAgent } from '../src/platform/agent/pi/runtime'
import { observeAgentModel } from '../src/platform/agent/pi/request-observer'

export const descriptor = (name = 'job.list'): AgentToolDescriptor => ({ name, description: `Describe ${name}`, inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1 } }, additionalProperties: false } })
export const capabilities = { contextWindow: 65536, maxOutputTokens: 8192, source: 'manual' as const, verified: true }
export const signal = () => new AbortController().signal
export interface WireTool { type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface WireRequest { model: string; stream: boolean; tools: WireTool[]; messages: { role: string; content: string; tool_calls?: { function: { name: string } }[] }[] }
const frame = (delta: unknown, finish_reason: string) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\ndata: [DONE]\n\n`
export const activation = (names = ['job.list']) => ({ name: 'tool.activate', arguments: { names } })
export function reply(calls: Omit<AgentToolCall, 'id'>[] | string, ordinal: number) {
  const delta = typeof calls === 'string' ? { content: calls } : { tool_calls: calls.map((call, index) => ({ index, id: `call-${ordinal}-${index}`, type: 'function', function: { name: stableName(call.name), arguments: JSON.stringify(call.arguments) } })) }
  return new Response(frame(delta, typeof calls === 'string' ? 'stop' : 'tool_calls'), { headers: { 'content-type': 'text/event-stream' } })
}
export function scriptedModel(script: (request: WireRequest, ordinal: number) => Omit<AgentToolCall, 'id'>[] | string) {
  const requests: WireRequest[] = []
  const model = compatibleAgentModel({ provider: { id: 'fixture', name: 'Fixture', baseURL: 'http://127.0.0.1/v1', requiresKey: false, models: ['test'], defaultModel: 'test' }, model: 'test', key: null }, {
     transport: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as WireRequest
      requests.push(body)
      const result = script(body, requests.length)
      return body.stream ? reply(result, requests.length) : new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: result } }] }), { headers: { 'content-type': 'application/json' } })
    }
  })
  return { model, requests }
}
export async function runDisclosure(model: StreamingAgentModel, tools: AgentTools, emit: (event: AgentRuntimeEvent) => void = () => {}) {
  model = observeAgentModel(model, emit)
  const budget = new ContextBudget(capabilities, 'fixture')
  const context = new ContextManager({ budget, model, checkpoint: { summary: '', revision: 0, compactedThroughSequence: 0 }, turns: [], memory: '', protectedState: [], compacting() {}, save: value => value })
  return runPiAgent({ model, tools, system: 'Test', message: 'List jobs', budget, context, emit, signal: signal(), status() {}, protect() {} })
}
