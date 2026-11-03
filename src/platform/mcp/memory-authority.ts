import { createServer } from 'node:http'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../knowledge/paths'
import { createHash, randomBytes } from 'node:crypto'
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Main owns random one-use credentials in memory; the disk descriptor contains only public routing data. */
export function createMemoryAuthority(directory: string) {
  const instance = randomBytes(32).toString('hex')
  const pending = new Map<string, { session: string; expires: number; maintenance: boolean }>()
  const grants = new Map<string, { session: string; operation: string; hash: string; expires: number; sources: string[] }>()
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !['/redeem', '/grant'].includes(req.url ?? '')) { res.writeHead(403).end(); return }
    try {
      let body = ''
      for await (const chunk of req) { body += chunk.toString(); if (body.length > 4096) { res.writeHead(403).end(); return } }
      const input = JSON.parse(body)
      if (req.url === '/grant') {
        const grant = grants.get(input.token); grants.delete(input.token)
        if (!grant || input.instance !== instance || input.session !== grant.session || input.operation !== grant.operation || input.hash !== grant.hash || grant.expires < Date.now() || !grant.sources.length) { res.writeHead(403).end(); return }
        res.writeHead(200).end('{}'); return
      }
      const credential = pending.get(input.credential)
      // Consume even failed attempts with a real credential. Replay never grants a session.
      pending.delete(input.credential)
      if (Object.keys(input).sort().join(',') !== 'credential,instance,session' || input.instance !== instance || !credential || credential.session !== input.session || credential.expires < Date.now()) { res.writeHead(403).end(); return }
      // Keep the authenticated control channel alive; Main shutdown revokes the child session.
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' })
      res.write(JSON.stringify({ instance, session: credential.session, maintenance: credential.maintenance }) + '\n')
    } catch { res.writeHead(403).end() }
  })
  server.requestTimeout = 5000; server.headersTimeout = 5000
  const descriptor = join(directory, 'smart-note-runtime', 'control.json')
  const ready = new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) }).then(async () => {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('MEMORY_AUTH_FAILED')
    await mkdir(join(directory, 'smart-note-runtime'), { recursive: true, mode: 0o700 })
    await atomicWrite(descriptor, JSON.stringify({ pid: process.pid, port: address.port, instance }))
  })
  ready.catch(() => {})
  return {
    async issue(session: string, maintenance = false) {
      await ready
      for (const [key, value] of pending) if (value.expires < Date.now()) pending.delete(key)
      const address = server.address()
      if (!address || typeof address === 'string' || !session || session.length > 128) throw new Error('MEMORY_AUTH_FAILED')
      const credential = randomBytes(32).toString('hex')
      pending.set(credential, { session, expires: Date.now() + 30000, maintenance })
      return JSON.stringify({ port: address.port, instance, session, credential })
    },
    grant(session: string, operation: string, args: unknown, sources: string[]) {
      if (!sources.length || !['memory.write', 'memory.mkdir'].includes(operation)) throw new Error('MEMORY_AUTH_FAILED')
      for (const [key, value] of grants) if (value.expires < Date.now()) grants.delete(key)
      const token = randomBytes(32).toString('hex')
      grants.set(token, { session, operation, hash: digest(args), sources: [...sources], expires: Date.now() + 30000 })
      return token
    },
    async close() { pending.clear(); grants.clear(); await ready; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); try { if (JSON.parse(await readFile(descriptor, 'utf8')).instance === instance) await unlink(descriptor) } catch { /* A replacement Main owns the descriptor. */ } }
  }
}
export interface MemoryAuthorization { signal: AbortSignal; maintenance?: boolean; authorize?(token: unknown, operation: string, args: unknown): Promise<boolean>; close(): void }
export async function redeemMemoryLaunch(raw: string | undefined, directory: string): Promise<MemoryAuthorization | undefined> {
  if (raw === undefined) return undefined
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const input = JSON.parse(raw)
    if (Object.keys(input).sort().join(',') !== 'credential,instance,port,session' || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535 || !/^[a-f0-9]{64}$/.test(input.instance) || !/^[a-f0-9]{64}$/.test(input.credential) || typeof input.session !== 'string' || !input.session || input.session.length > 128) throw new Error()
    const trusted = JSON.parse(await readFile(join(directory, 'smart-note-runtime', 'control.json'), 'utf8'))
    if (trusted.pid !== process.ppid || trusted.port !== input.port || trusted.instance !== input.instance) throw new Error()
    const { port, ...body } = input
    const response = await fetch(`http://127.0.0.1:${port}/redeem`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: controller.signal })
    if (!response.ok || !response.body) throw new Error()
    const reader = response.body.getReader()
    let line = ''
    while (!line.endsWith('\n')) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error()
      line += new TextDecoder().decode(chunk.value)
      if (line.length > 2048) throw new Error()
    }
    const result = JSON.parse(line)
    if (result.instance !== input.instance || result.session !== input.session) throw new Error()
    clearTimeout(timeout)
    void (async () => { try { while (!(await reader.read()).done) { /* Main owns channel lifetime. */ } } catch { /* Disconnect revokes authorization. */ } finally { controller.abort() } })()
    return { signal: controller.signal, maintenance: result.maintenance === true, async authorize(token, operation, args) {
      if (result.maintenance !== true || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false
      try {
        const reply = await fetch(`http://127.0.0.1:${port}/grant`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, operation, hash: digest(args), instance: input.instance, session: input.session }) })
        await reply.body?.cancel(); return reply.ok
      } catch { return false }
    }, close: () => controller.abort() }
  } catch { controller.abort(); throw new Error('MEMORY_AUTH_FAILED') }
  finally { clearTimeout(timeout) }
}
