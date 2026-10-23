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
      const jobId = /Job ID: ([\w-]+)/.exec(prompt)![1], profileId = /Profile ID: ([\w-]+)/.exec(prompt)![1]
      const observations = value.messages.filter((message: { role: string }) => message.role === 'tool')
      const finish = (message: unknown, finish_reason = 'stop') => {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ finish_reason, message }] }))
      }
      if (!observations.length && stage !== 'polish') {
        return finish({ role: 'assistant', content: null, tool_calls: [
          { id: randomUUID(), type: 'function', function: { name: 'tool_0', arguments: JSON.stringify({ id: jobId }) } },
          { id: randomUUID(), type: 'function', function: { name: 'tool_1', arguments: JSON.stringify({ id: profileId }) } },
          { id: randomUUID(), type: 'function', function: { name: 'tool_2', arguments: JSON.stringify({ profileId, limit: 100, offset: 0 }) } }
        ] }, 'tool_calls')
      }
      if (observations.length) {
        const [job, profile, facts] = observations.map((message: { content: string }) => JSON.parse(message.content).structuredContent)
        cache.set(profileId, { schemaVersion: 1, job, ...profile, facts: facts.items })
      }
      const snapshot = cache.get(profileId)!
      let output: unknown
      if (stage === 'score') output = { language: /[\u4e00-\u9fff]/.test(snapshot.job.description) ? 'zh-CN' : 'en', scores: snapshot.facts.map(fact => ({ factId: fact.id, score: 90, reason: 'Relevant saved evidence' })) }
      else if (stage === 'gate') output = { passed: true, reason: 'Sufficient saved evidence', missingRequirements: [] }
      else if (stage === 'select') output = { factIds: snapshot.facts.map(fact => fact.id), itemIds: snapshot.items.map(item => item.id), wordBudget: 500 }
      else if (stage === 'draft') {
        const entries = (type: string) => snapshot.items.filter(item => item.type === type).map(item => ({ profileItemId: item.id,
          bullets: snapshot.facts.filter(fact => fact.profileItemId === item.id).map(fact => ({ id: randomUUID(), text: fact.content, factIds: [fact.id] })) }))
        output = { summary: { id: randomUUID(), text: snapshot.facts[0].content, factIds: [snapshot.facts[0].id] }, experience: entries('EXPERIENCE'), projects: entries('PROJECT'), education: entries('EDUCATION'),
          skills: snapshot.facts.filter(fact => !fact.profileItemId).map(fact => ({ id: randomUUID(), text: fact.content, factIds: [fact.id] })) }
      } else if (stage === 'polish') output = JSON.parse(prompt.split('\nDraft: ')[1])
      else output = { error: 'unknown stage' }
      finish({ role: 'assistant', content: JSON.stringify(output) })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests: () => requests, hook: (hook?: typeof stageHook) => { stageHook = hook },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }) }
}
