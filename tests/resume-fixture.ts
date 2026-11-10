import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'

/** Offline compatible model that reads the baseline and preserves evidence while changing phrasing. */
export async function resumeFixture(batchSize = 1) {
  let requests = 0, hook: ((stage: string, response: ServerResponse) => boolean) | undefined
  const server = createServer((request, response) => {
    if (request.url === '/api/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ models: [{ key: 'fixture', loaded_instances: [{ id: 'fixture', config: { context_length: 65536 } }] }] }))
      return
    }
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      requests++
      if (hook?.('rewrite', response)) return
      const { messages, tools } = JSON.parse(body)
      const runId = /generation run ([a-f0-9-]+)/.exec(messages.find((message: { content: string }) => message.content?.includes('generation run ')).content)![1]
      const observations = messages.filter((message: { role: string }) => message.role === 'tool').map((message: { content: string }) => JSON.parse(message.content))
      const finish = (delta: unknown, reason = 'stop') => {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`)
      }
      const call = (name: string, args: object, index: number) => ({ index, id: randomUUID(), type: 'function', function: {
        name: tools.find((tool: { function: { description: string } }) => tool.function.description.startsWith(`[${name}]`)).function.name,
        arguments: JSON.stringify(name.startsWith('scope.') ? args : { runId, ...args }) } })
      if (!tools.some((tool: { function: { description: string } }) => tool.function.description.startsWith('[resume.get_context]'))) return finish({ tool_calls: [call('scope.resume', {}, 0)] }, 'tool_calls')
      if (!observations.some((item: { scope?: string }) => !item.scope)) return finish({ tool_calls: ['resume.get_context', 'resume.list_facts', 'resume.list_bullets'].map((name, i) => call(name, {}, i)) }, 'tool_calls')
      const page = observations.find((item: { items?: { bulletId?: string }[] }) => Array.isArray(item.items) && item.items.some((bullet: { bulletId?: string }) => bullet.bulletId))
      const rewrites = observations.filter((item: { changed?: boolean }) => item.changed !== undefined)
      const bullets = page?.items.slice(rewrites.length, Math.min(2, rewrites.length + batchSize)) ?? []
      if (bullets.length) {
        return finish({ tool_calls: bullets.map((bullet: { bulletId: string; text: string }, index: number) => {
          const text = bullet.text.replace(/[。.]?$/, /[\u4e00-\u9fff]/.test(bullet.text) ? '。' : '.')
          return call('resume.rewrite_bullet', { bulletId: bullet.bulletId, text, requestId: randomUUID() }, index)
        }) }, 'tool_calls')
      }
      finish({ content: 'Reviewed and tailored the source bullets.' })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests: () => requests, hook: (next?: typeof hook) => { hook = next },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }) }
}
