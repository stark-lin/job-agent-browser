import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from './paths'
import type { KnowledgeIndex } from './rag'
export async function startKnowledgeBroker(directory: string, index: KnowledgeIndex) {
  const token = randomBytes(32).toString('hex'),
    path = join(directory, 'knowledge-runtime', 'broker.json')
  let active = 0
  const server = createServer(async (req, res) => {
    const expected = Buffer.from(`Bearer ${token}`),
      supplied = Buffer.from(req.headers.authorization ?? '')
    if (
      req.method !== 'POST' ||
      req.url !== '/query' ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      res.writeHead(403).end()
      return
    }
    if (active >= 4) {
      res.writeHead(429).end()
      return
    }
    active++
    try {
      let body = ''
      for await (const value of req) {
        body += value.toString()
        if (Buffer.byteLength(body) > 8192) {
          res.writeHead(413).end()
          return
        }
      }
      const input = JSON.parse(body) as { query: unknown }
      if (
        Object.keys(input).length !== 1 ||
        typeof input.query !== 'string' ||
        !input.query.trim() ||
        input.query.length > 2048
      ) {
        res.writeHead(400).end()
        return
      }
      const vector = await index.queryVector(input.query)
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(vector ?? null))
    } catch {
      res.writeHead(503).end()
    } finally {
      active--
    }
  })
  server.requestTimeout = 35000
  server.headersTimeout = 5000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('BROKER_FAILED')
  await mkdir(join(directory, 'knowledge-runtime'), { recursive: true, mode: 0o700 })
  await atomicWrite(path, JSON.stringify({ port: address.port, token }))
  return async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    try {
      if (JSON.parse(await readFile(path, 'utf8')).token === token) await unlink(path)
    } catch {
      /* Another Main may own the descriptor. */
    }
  }
}
