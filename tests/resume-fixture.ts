import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { InputSnapshot } from '../src/domain/resume/resume.types'
import { randomUUID } from 'node:crypto'

/** Offline deterministic compatible server. Generated prose repeats reviewed source facts. */
export async function resumeFixture() {
  let requests = 0, stageHook: ((stage: string, response: ServerResponse) => boolean) | undefined
  const cache = new Map<string, InputSnapshot>()
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      requests++
      const value = JSON.parse(body), prompt: string = value.messages[0].content
      const stage = /Stage: ([\w-]+)/.exec(prompt)?.[1] ?? ''
      if (stageHook?.(stage, response)) return
      const runId = /Run ID: ([\w-]+)/.exec(prompt)![1]
      const observations = value.messages.filter((message: { role: string }) => message.role === 'tool')
      const finish = (message: unknown, finish_reason = 'stop') => {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ finish_reason, message }] }))
      }
      if (!observations.length) {
        return finish({ role: 'assistant', content: null, tool_calls: [
          { id: randomUUID(), type: 'function', function: { name: 'tool_0', arguments: JSON.stringify({ runId }) } },
          { id: randomUUID(), type: 'function', function: { name: 'tool_1', arguments: JSON.stringify({ runId, limit: 100, offset: 0 }) } }
        ] }, 'tool_calls')
      }
      if (observations.length) {
        const [context, facts] = observations.map((message: { content: string }) => (JSON.parse(message.content).structuredContent ?? JSON.parse(message.content)))
        cache.set(runId, { schemaVersion: 1, job: context.job, profile: context.profile, items: context.items, facts: facts.items })
      }
      const snapshot = cache.get(runId)!
      const statement = (fact: InputSnapshot['facts'][number]) => ({ text: fact.content, factIds: [fact.id] })
      const output = { language: /[\u4e00-\u9fff]/.test(snapshot.job.description) ? 'zh-CN' : 'en',
        summary: { ...statement(snapshot.facts[0]), text: snapshot.profile.introduction || snapshot.facts[0].content },
        entries: snapshot.items.map(item => ({ profileItemId: item.id, bullets: snapshot.facts.filter(fact => fact.profileItemId === item.id).map(statement) })),
        skills: snapshot.facts.filter(fact => fact.kind === 'SKILL').map(statement) }
      finish({ role: 'assistant', content: JSON.stringify(output) })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests: () => requests, hook: (hook?: typeof stageHook) => { stageHook = hook },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }) }
}
