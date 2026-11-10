import type { HumanRequests } from './human-requests'
import { createServer, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../knowledge/paths'
import { toolError } from '../../shared/tools/errors'
import type { RunAdmission } from './run-admission'

export const executionTimeoutMs = 15 * 60 * 1000
/** Separate protected channel: its credentials never authorize Memory or internal tools. */
export function createAdmissionBroker(directory: string, admission: RunAdmission, timeoutMs = executionTimeoutMs, human?: HumanRequests) {
  const token = randomBytes(32).toString('hex'), path = join(directory, 'run-runtime', 'control.json')
  let closing = false
  const retired = new Set<() => void>()
  let session: { owner: string; secret: string; pid: number; response: ServerResponse; disconnected: boolean; runId?: string; lastId?: string; timer?: ReturnType<typeof setTimeout> } | undefined
  function end() {
    if (!session?.runId) return
    human?.cancelOwner(session.runId)
    admission.release(session.owner, session.runId); session.lastId = session.runId; session.runId = undefined
    clearTimeout(session.timer)
  }
  function retire() {
    if (!session) return
    end(); admission.closeExternal(session.owner); session.response.end(); session = undefined
    for (const resolve of retired) resolve(); retired.clear()
  }
  const server = createServer(async (req, res) => {
    const expected = Buffer.from(`Bearer ${token}`), supplied = Buffer.from(req.headers.authorization ?? '')
    if (req.method !== 'POST' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(403).end(); return }
    try {
      let body = ''
      for await (const chunk of req) { body += chunk.toString(); if (body.length > 65536) throw new Error() }
      const input = JSON.parse(body)
      if (closing && ['/session', '/begin'].includes(req.url ?? '')) { res.writeHead(503).end(); return }
      if (req.url === '/session') {
        if (Object.keys(input).join(',') !== 'pid' || !Number.isSafeInteger(input.pid) || input.pid < 1) { res.writeHead(400).end(); return }
        const owner = randomUUID(); admission.openExternal(owner)
        const entry = { owner, secret: randomBytes(32).toString('hex'), pid: input.pid, response: res, disconnected: false }
        session = entry
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' })
        res.on('close', () => { entry.disconnected = true; if (session?.runId) human?.cancelOwner(session.runId) })
        res.write(JSON.stringify({ session: entry.secret }) + '\n'); return
      }
      if (!session || input.session !== session.secret) { res.writeHead(403).end(); return }
      if (req.url === '/human-ask') {
        if (!human || !session.runId || input.runId !== session.runId || session.disconnected) { res.writeHead(403).end(); return }
        const disconnected = new AbortController()
        res.on('close', () => disconnected.abort())
        try {
          const result = await human.ask(session.runId, input.input, disconnected.signal)
          res.writeHead(200).end(JSON.stringify(result))
        } catch { if (!res.destroyed) res.writeHead(409).end(JSON.stringify({ error: 'TOOL_CANCELLED' })) }
        return
      }
      if (req.url === '/begin') {
        if (Object.keys(input).join(',') !== 'session' || session.disconnected) { res.writeHead(403).end(); return }
        const run = admission.acquire(session.owner); session.runId = run.id
        session.timer = setTimeout(() => {
          if (session?.runId === run.id) { human?.cancelOwner(run.id); session.response.write(JSON.stringify({ type: 'timeout', runId: run.id }) + '\n') }
        }, timeoutMs)
        session.timer.unref()
        res.writeHead(200).end(JSON.stringify({ runId: run.id })); return
      }
      if (req.url === '/end') {
        if (Object.keys(input).sort().join(',') !== 'runId,session' || ![session.runId, session.lastId].includes(input.runId)) { res.writeHead(403).end(); return }
        if (session.runId === input.runId) end()
        if (session.disconnected) retire()
        res.writeHead(200).end('{}'); return
      }
      if (req.url === '/close') { retire(); res.writeHead(200).end('{}'); return }
      res.writeHead(403).end()
    } catch (error) { res.writeHead(409).end(JSON.stringify({ error: toolError(error).code })) }
  })
  server.requestTimeout = 5000; server.headersTimeout = 5000
  // A severed control channel fences the child. Keep admission until its drain acknowledgement
  // or confirmed process exit, so a live async tool cannot overlap the next Run.
  const reaper = setInterval(() => {
    if (!session?.disconnected) return
    try { process.kill(session.pid, 0) } catch { retire() }
  }, 250)
  reaper.unref()
  const ready = new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) }).then(async () => {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('ADMISSION_UNAVAILABLE')
    await mkdir(join(directory, 'run-runtime'), { recursive: true, mode: 0o700 })
    await atomicWrite(path, JSON.stringify({ port: address.port, token }))
  })
  ready.catch(() => {})
  return { ready, async close() {
    closing = true; if (session?.runId) human?.cancelOwner(session.runId); await ready.catch(() => {})
    if (session) {
      const drained = new Promise<void>(resolve => retired.add(resolve))
      if (!session.disconnected) session.response.write(JSON.stringify({ type: 'shutdown' }) + '\n')
      await drained
    }
    clearInterval(reaper); server.closeAllConnections()
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    try { if (JSON.parse(await readFile(path, 'utf8')).token === token) await unlink(path) } catch { /* A replacement Main owns the descriptor. */ }
  } }
}
