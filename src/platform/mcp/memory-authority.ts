import { createServer, type ServerResponse } from 'node:http'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../knowledge/paths'
import { randomBytes } from 'node:crypto'
import { callDigest as digest } from './call-fingerprint'
import type { TrustedRunContext } from '../mcp-server/run-guard'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
/** Main owns random one-use credentials in memory; the disk descriptor contains only public routing data. */
export function createMemoryAuthority(directory: string) {
  const instance = randomBytes(32).toString('hex')
  const pending = new Map<string, { session: string; expires: number }>()
  const grants = new Map<string, { session: string; operation: string; hash: string; expires: number; sources: string[] }>()
  const runs = new Map<string, { session: string; sessionId: string }>()
  const runGrants = new Map<string, { chatRunId: string; session: string; operation: string; hash: string; expires: number }>()
  const channels = new Map<string, ServerResponse>()
  const acknowledgements = new Map<string, { session: string; resolve(): void }>()
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !['/redeem', '/grant', '/run-grant', '/run-closed'].includes(req.url ?? '')) { res.writeHead(403).end(); return }
    try {
      let body = ''
      for await (const chunk of req) { body += chunk.toString(); if (body.length > 4096) { res.writeHead(403).end(); return } }
      const input = JSON.parse(body)
      if (req.url === '/run-closed') {
        const ack = acknowledgements.get(input.token)
        if (!ack || input.instance !== instance || input.session !== ack.session) { res.writeHead(403).end(); return }
        acknowledgements.delete(input.token); ack.resolve(); res.writeHead(200).end('{}'); return
      }
      if (req.url === '/run-grant') {
        const grant = runGrants.get(input.token); runGrants.delete(input.token)
        const run = grant && runs.get(grant.chatRunId)
        if (!grant || !run || input.instance !== instance || input.session !== grant.session || run.session !== grant.session
          || input.operation !== grant.operation || input.hash !== grant.hash || grant.expires < Date.now()) { res.writeHead(403).end(); return }
        res.writeHead(200).end(JSON.stringify({ chatRunId: grant.chatRunId, sessionId: run.sessionId })); return
      }
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
      if (channels.has(credential.session)) { res.end(); return }
      channels.set(credential.session, res)
      res.on('close', () => {
        if (channels.get(credential.session) === res) channels.delete(credential.session)
        for (const [id, run] of runs) if (run.session === credential.session) runs.delete(id)
      })
      res.write(JSON.stringify({ instance, session: credential.session }) + '\n')
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
    async issue(session: string) {
      await ready
      for (const [key, value] of pending) if (value.expires < Date.now()) pending.delete(key)
      const address = server.address()
      if (!address || typeof address === 'string' || !session || session.length > 128) throw new Error('MEMORY_AUTH_FAILED')
      const credential = randomBytes(32).toString('hex')
      pending.set(credential, { session, expires: Date.now() + 30000 })
      return JSON.stringify({ port: address.port, instance, session, credential })
    },
    registerRun(session: string, chatRunId: string, sessionId: string) {
      if (!uuid.test(chatRunId) || !sessionId || sessionId.length > 128 || runs.has(chatRunId) || !channels.has(session)) throw new Error('MEMORY_AUTH_FAILED')
      runs.set(chatRunId, { session, sessionId })
      let closing: Promise<void> | undefined
      return {
        grant(operation: string, args: unknown) {
          if (runs.get(chatRunId)?.session !== session || !channels.has(session)) throw new Error('MEMORY_AUTH_FAILED')
          for (const [key, value] of runGrants) if (value.expires < Date.now()) runGrants.delete(key)
          const token = randomBytes(32).toString('hex')
          runGrants.set(token, { chatRunId, session, operation, hash: digest(args), expires: Date.now() + 30000 })
          return token
        },
        close() {
          return closing ??= (async () => {
            runs.delete(chatRunId)
            for (const [key, value] of runGrants) if (value.chatRunId === chatRunId) runGrants.delete(key)
            const channel = channels.get(session)
            if (!channel || channel.destroyed) throw new Error('MEMORY_AUTH_FAILED')
            const token = randomBytes(32).toString('hex')
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => { acknowledgements.delete(token); reject(new Error('MEMORY_AUTH_FAILED')) }, 5000)
              acknowledgements.set(token, { session, resolve() { clearTimeout(timer); resolve() } })
              channel.write(JSON.stringify({ type: 'run.closed', chatRunId, token }) + '\n')
            })
          })()
        }
      }
    },
    grant(session: string, operation: string, args: unknown, sources: string[]) {
      if (!sources.length || !['memory.write', 'memory.mkdir'].includes(operation)) throw new Error('MEMORY_AUTH_FAILED')
      for (const [key, value] of grants) if (value.expires < Date.now()) grants.delete(key)
      const token = randomBytes(32).toString('hex')
      grants.set(token, { session, operation, hash: digest(args), sources: [...sources], expires: Date.now() + 30000 })
      return token
    },
    async close() { pending.clear(); grants.clear(); runs.clear(); runGrants.clear(); await ready.catch(() => {}); if (!server.listening) return; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); try { if (JSON.parse(await readFile(descriptor, 'utf8')).instance === instance) await unlink(descriptor) } catch { /* A replacement Main owns the descriptor. */ } }
  }
}
export interface MemoryAuthorization {
  signal: AbortSignal
  authorize?(token: unknown, operation: string, args: unknown): Promise<boolean>
  authorizeRun(token: unknown, operation: string, args: unknown): Promise<TrustedRunContext | undefined>
  onRunClosed(listener: (id: string) => Promise<void>): void
  close(): void
}
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
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let buffer = ''
    async function readLine(): Promise<string> {
      while (!buffer.includes('\n')) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error()
        buffer += decoder.decode(chunk.value, { stream: true })
        if (buffer.length > 65536) throw new Error()
      }
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1); return line
    }
    const result = JSON.parse(await readLine())
    if (result.instance !== input.instance || result.session !== input.session) throw new Error()
    clearTimeout(timeout)
    const runControllers = new Map<string, AbortController>(), closed = new Set<string>()
    let runClosed: (id: string) => Promise<void> = async () => {}
    const post = (path: string, payload: object) => fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, instance: input.instance, session: input.session }) })
    void (async () => {
      try {
        for (;;) {
          const event = JSON.parse(await readLine())
          if (event.type !== 'run.closed' || !uuid.test(event.chatRunId) || typeof event.token !== 'string') throw new Error()
          closed.add(event.chatRunId); runControllers.get(event.chatRunId)?.abort(); runControllers.delete(event.chatRunId)
          await runClosed(event.chatRunId)
          const reply = await post('/run-closed', { token: event.token }); await reply.body?.cancel()
          if (!reply.ok) throw new Error()
        }
      } catch { /* Disconnect revokes every execution context. */ }
      finally { controller.abort(); for (const run of runControllers.values()) run.abort(); runControllers.clear() }
    })()
    return { signal: controller.signal,
      onRunClosed(listener) { runClosed = listener },
      async authorizeRun(token, operation, args) {
        if (controller.signal.aborted || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return
        try {
          const reply = await post('/run-grant', { token, operation, hash: digest(args) })
          if (!reply.ok) { await reply.body?.cancel(); return }
          const run = await reply.json() as { chatRunId: string; sessionId: string }
          if (!uuid.test(run.chatRunId) || typeof run.sessionId !== 'string' || !run.sessionId || run.sessionId.length > 128 || closed.has(run.chatRunId) || controller.signal.aborted) return
          let runController = runControllers.get(run.chatRunId)
          if (!runController) { runController = new AbortController(); runControllers.set(run.chatRunId, runController) }
          return { ...run, signal: AbortSignal.any([controller.signal, runController.signal]) }
        } catch { return }
      }, async authorize(token, operation, args) {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false
      try {
        const reply = await fetch(`http://127.0.0.1:${port}/grant`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, operation, hash: digest(args), instance: input.instance, session: input.session }) })
        await reply.body?.cancel(); return reply.ok
      } catch { return false }
    }, close: () => controller.abort() }
  } catch { controller.abort(); throw new Error('MEMORY_AUTH_FAILED') }
  finally { clearTimeout(timeout) }
}
