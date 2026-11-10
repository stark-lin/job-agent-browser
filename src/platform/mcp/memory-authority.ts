import { ToolError } from '../../shared/tools/errors'
import type { HumanAskResult } from '../../shared/human'
import type { HumanRequests } from './human-requests'
import { allowsAgentControl } from '../../shared/agent/context-policy'
import { createServer, type ServerResponse } from 'node:http'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../knowledge/paths'
import { createRunAdmission, type RunAdmission, type ExecutionRun } from './run-admission'
import { randomBytes } from 'node:crypto'
import { callDigest as digest } from './call-fingerprint'
import { jobAgentAllowlist } from '../../shared/agent/business-policy'
import { askToolAllowlist } from '../../shared/agent/ask-policy'
import { resumeAgentTools, resumeAgentLifecycle } from '../../shared/agent/resume-policy'
import type { TrustedRunContext } from '../mcp-server/run-guard'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
type RunPolicy = { kind: 'ask' | 'resume' | 'business' | 'resume-controller'; generationRunId?: string }
const toolPolicy: Record<RunPolicy['kind'], readonly string[]> = {
  business: jobAgentAllowlist, ask: askToolAllowlist, resume: resumeAgentTools, 'resume-controller': resumeAgentLifecycle
}
function allows(run: RunPolicy, operation: string, args: unknown) {
  return (toolPolicy[run.kind].includes(operation) || allowsAgentControl(operation, toolPolicy[run.kind]))
    && (run.kind !== 'resume' || !operation.startsWith('resume.') || (args as { runId?: string } | null)?.runId === run.generationRunId)
}

/** Main owns random one-use credentials in memory; the disk descriptor contains only public routing data. */
export function createMemoryAuthority(directory: string, admission: RunAdmission = createRunAdmission(), human?: HumanRequests) {
  const instance = randomBytes(32).toString('hex')
  const pending = new Map<string, { session: string; kind: 'ask' | 'resume' | 'business'; expires: number }>()
  const grants = new Map<string, { session: string; operation: string; hash: string; expires: number; agentRunId: string; origin: { kind: 'ask'; sourceMessageIds: string[] } | { kind: 'resume'; generationRunId: string } }>()
  const occupancy = new Map<string, { run: ExecutionRun; refs: number }>()
  const runs = new Map<string, { executionRunId: string; session: string; sessionId: string; controller: AbortController } & RunPolicy>()
  const runGrants = new Map<string, { agentRunId: string; session: string; operation: string; hash: string; expires: number }>()
  const humanTokens = new Map<string, { agentRunId: string; session: string }>()
  const channels = new Map<string, { response: ServerResponse; kind: 'ask' | 'resume' | 'business' }>()
  const acknowledgements = new Map<string, { session: string; resolve(): void }>()
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !['/redeem', '/grant', '/run-grant', '/run-closed', '/human-ask'].includes(req.url ?? '')) { res.writeHead(403).end(); return }
    try {
      let body = ''
      for await (const chunk of req) { body += chunk.toString(); if (body.length > 65536) { res.writeHead(403).end(); return } }
      const input = JSON.parse(body)
      if (req.url === '/human-ask') {
        const grant = humanTokens.get(input.token); humanTokens.delete(input.token)
        const run = grant && runs.get(grant.agentRunId)
        if (!human || !grant || !run || input.instance !== instance || input.session !== grant.session || run.session !== grant.session || !channels.has(grant.session)) { res.writeHead(403).end(); return }
        const disconnected = new AbortController()
        res.on('close', () => disconnected.abort())
        try {
          const result = await human.ask(grant.agentRunId, input.input, AbortSignal.any([run.controller.signal, disconnected.signal]))
          res.writeHead(200).end(JSON.stringify(result))
        } catch { if (!res.destroyed) res.writeHead(409).end(JSON.stringify({ error: 'TOOL_CANCELLED' })) }
        return
      }
      if (req.url === '/run-closed') {
        const ack = acknowledgements.get(input.token)
        if (!ack || input.instance !== instance || input.session !== ack.session) { res.writeHead(403).end(); return }
        acknowledgements.delete(input.token); ack.resolve(); res.writeHead(200).end('{}'); return
      }
      if (req.url === '/run-grant') {
        const grant = runGrants.get(input.token); runGrants.delete(input.token)
        const run = grant && runs.get(grant.agentRunId)
        if (!grant || !run || input.instance !== instance || input.session !== grant.session || run.session !== grant.session
          || input.operation !== grant.operation || input.hash !== grant.hash || grant.expires < Date.now()) { res.writeHead(403).end(); return }
        let humanToken: string | undefined
        if (grant.operation === 'human.ask') { humanToken = randomBytes(32).toString('hex'); humanTokens.set(humanToken, { agentRunId: grant.agentRunId, session: grant.session }) }
        res.writeHead(200).end(JSON.stringify({ humanToken, executionRunId: run.executionRunId, agentRunId: ['resume-controller', 'business'].includes(run.kind) ? undefined : grant.agentRunId, sessionId: run.sessionId, kind: run.kind, generationRunId: run.generationRunId })); return
      }
      if (req.url === '/grant') {
        const grant = grants.get(input.token); grants.delete(input.token)
        const run = grant && runs.get(grant.agentRunId)
        const originValid = grant?.origin.kind === 'ask' ? grant.origin.sourceMessageIds.length > 0 : grant?.origin.kind === 'resume' && run?.generationRunId === grant.origin.generationRunId
        if (!grant || !run || run.kind !== grant.origin.kind || run.session !== grant.session || !originValid || input.instance !== instance || input.session !== grant.session || input.operation !== grant.operation || input.hash !== grant.hash || grant.expires < Date.now()) { res.writeHead(403).end(); return }
        res.writeHead(200).end('{}'); return
      }
      const credential = pending.get(input.credential)
      // Consume even failed attempts with a real credential. Replay never grants a session.
      pending.delete(input.credential)
      if (Object.keys(input).sort().join(',') !== 'credential,instance,session' || input.instance !== instance || !credential || credential.session !== input.session || credential.expires < Date.now()) { res.writeHead(403).end(); return }
      // Keep the authenticated control channel alive; Main shutdown revokes the child session.
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' })
      if (channels.has(credential.session)) { res.end(); return }
      channels.set(credential.session, { response: res, kind: credential.kind })
      res.on('close', () => {
        if (channels.get(credential.session)?.response === res) channels.delete(credential.session)
        for (const [id, run] of runs) if (run.session === credential.session) { run.controller.abort(); runs.delete(id) }
        // The stdio owner retires occupancy after process closure, following tool drain.
      })
      res.write(JSON.stringify({ instance, session: credential.session, kind: credential.kind }) + '\n')
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
    retireSession(session: string) {
      channels.get(session)?.response.end(); channels.delete(session)
      for (const [id, run] of runs) if (run.session === session) { run.controller.abort(); runs.delete(id) }
      const held = occupancy.get(session)
      if (held) { admission.release(session, held.run.id); occupancy.delete(session) }
    },
    async issue(session: string, kind: 'ask' | 'resume' | 'business' = 'ask') {
      await ready
      for (const [key, value] of pending) if (value.expires < Date.now()) pending.delete(key)
      const address = server.address()
      if (!address || typeof address === 'string' || !session || session.length > 128) throw new Error('MEMORY_AUTH_FAILED')
      const credential = randomBytes(32).toString('hex')
      pending.set(credential, { session, kind, expires: Date.now() + 30000 })
      return JSON.stringify({ port: address.port, instance, session, credential })
    },
    registerRun(session: string, businessRunId: string | undefined, sessionId: string, policy: RunPolicy = { kind: 'ask' }) {
      if (channels.get(session)?.kind !== (policy.kind === 'resume-controller' ? 'resume' : policy.kind)) throw new Error('MEMORY_AUTH_FAILED')
      if (policy.kind === 'resume' && !uuid.test(policy.generationRunId ?? '')) throw new Error('MEMORY_AUTH_FAILED')
      const agentRunId = businessRunId ?? session
      if ((!['resume-controller', 'business'].includes(policy.kind) && !uuid.test(agentRunId)) || !sessionId || sessionId.length > 128 || runs.has(agentRunId) || !channels.has(session)) throw new Error('MEMORY_AUTH_FAILED')
      let held = occupancy.get(session)
      if (held && policy.kind !== 'resume') throw new Error('MEMORY_AUTH_FAILED')
      if (!held) { held = { run: admission.acquire(session), refs: 0 }; occupancy.set(session, held) }
      held.refs++
      const executionRunId = held.run.id
      const runController = new AbortController()
      runs.set(agentRunId, { executionRunId, session, sessionId, controller: runController, ...policy })
      let closing: Promise<void> | undefined
      return {
        executionRunId,
        grant(operation: string, args: unknown) {
          if (runs.get(agentRunId)?.session !== session || !channels.has(session)) throw new Error('MEMORY_AUTH_FAILED')
          for (const [key, value] of runGrants) if (value.expires < Date.now()) runGrants.delete(key)
          const token = randomBytes(32).toString('hex')
          runGrants.set(token, { agentRunId, session, operation, hash: digest(args), expires: Date.now() + 30000 })
          return token
        },
        memoryGrant(operation: string, args: unknown) {
          const run = runs.get(agentRunId)
          if (run?.kind !== 'resume' || run.session !== session || !channels.has(session) || !['memory.write', 'memory.mkdir'].includes(operation)) throw new Error('MEMORY_AUTH_FAILED')
          const token = randomBytes(32).toString('hex')
          grants.set(token, { session, operation, hash: digest(args), origin: { kind: 'resume', generationRunId: run.generationRunId! }, agentRunId, expires: Date.now() + 30000 })
          return token
        },
        close() {
          return closing ??= (async () => {
            runController.abort(); runs.delete(agentRunId)
            for (const [token, grant] of humanTokens) if (grant.agentRunId === agentRunId) humanTokens.delete(token)
            for (const [key, value] of runGrants) if (value.agentRunId === agentRunId) runGrants.delete(key)
            const channel = channels.get(session)?.response
            if (!channel || channel.destroyed) throw new Error('MEMORY_AUTH_FAILED')
            const token = randomBytes(32).toString('hex')
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => { acknowledgements.delete(token); reject(new Error('MEMORY_AUTH_FAILED')) }, 5000)
              acknowledgements.set(token, { session, resolve() { clearTimeout(timer); resolve() } })
              channel.write(JSON.stringify({ type: 'run.closed', agentRunId, executionRunId, final: held!.refs === 1, token }) + '\n')
            })
            if (--held!.refs === 0) { admission.release(session, executionRunId); occupancy.delete(session) }
          })()
        }
      }
    },
    grant(session: string, operation: string, args: unknown, sources: string[]) {
      if (!sources.length || !['memory.write', 'memory.mkdir'].includes(operation)) throw new Error('MEMORY_AUTH_FAILED')
      for (const [key, value] of grants) if (value.expires < Date.now()) grants.delete(key)
      const token = randomBytes(32).toString('hex')
      const registered = [...runs.entries()].find(([, run]) => run.session === session && run.kind === 'ask')
      if (!registered) throw new Error('MEMORY_AUTH_FAILED')
      grants.set(token, { session, operation, hash: digest(args), origin: { kind: 'ask', sourceMessageIds: [...sources] }, agentRunId: registered[0], expires: Date.now() + 30000 })
      return token
    },
    async close() { for (const [owner, held] of occupancy) admission.release(owner, held.run.id); occupancy.clear(); pending.clear(); grants.clear(); for (const run of runs.values()) run.controller.abort(); runs.clear(); humanTokens.clear(); runGrants.clear(); await ready.catch(() => {}); if (!server.listening) return; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); try { if (JSON.parse(await readFile(descriptor, 'utf8')).instance === instance) await unlink(descriptor) } catch { /* A replacement Main owns the descriptor. */ } }
  }
}
export interface MemoryAuthorization {
  kind: 'ask' | 'resume' | 'business'
  signal: AbortSignal
  authorize?(token: unknown, operation: string, args: unknown): Promise<boolean>
  authorizeRun(token: unknown, operation: string, args: unknown): Promise<TrustedRunContext | undefined>
  ask(run: TrustedRunContext, input: unknown, signal: AbortSignal): Promise<HumanAskResult>
  onRunClosed(listener: (id: string, final: boolean) => Promise<void>): void
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
    if (result.instance !== input.instance || result.session !== input.session || !['ask', 'resume', 'business'].includes(result.kind)) throw new Error()
    clearTimeout(timeout)
    const runControllers = new Map<string, AbortController>(), closed = new Set<string>()
    let runClosed: (id: string, final: boolean) => Promise<void> = async () => {}
    const post = (path: string, payload: object) => fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, instance: input.instance, session: input.session }) })
    void (async () => {
      try {
        for (;;) {
          const event = JSON.parse(await readLine())
          if (event.type !== 'run.closed' || typeof event.agentRunId !== 'string' || !uuid.test(event.executionRunId) || typeof event.final !== 'boolean' || typeof event.token !== 'string') throw new Error()
          closed.add(event.agentRunId); runControllers.get(event.agentRunId)?.abort(); runControllers.delete(event.agentRunId)
          await runClosed(event.executionRunId, event.final)
          const reply = await post('/run-closed', { token: event.token }); await reply.body?.cancel()
          if (!reply.ok) throw new Error()
        }
      } catch { /* Disconnect revokes every execution context. */ }
      finally { controller.abort(); for (const run of runControllers.values()) run.abort(); runControllers.clear() }
    })()
    return { kind: result.kind, signal: controller.signal,
      async ask(run, question, signal) {
        const reply = await fetch(`http://127.0.0.1:${port}/human-ask`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([controller.signal, signal]), headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instance: input.instance, session: input.session, token: run.humanToken, input: question }) })
        if (!reply.ok) { await reply.body?.cancel(); throw new ToolError('TOOL_CANCELLED') }
        return await reply.json() as HumanAskResult
      },
      onRunClosed(listener) { runClosed = listener },
      async authorizeRun(token, operation, args) {
        if (controller.signal.aborted || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return
        try {
          const reply = await post('/run-grant', { token, operation, hash: digest(args) })
          if (!reply.ok) { await reply.body?.cancel(); return }
          const run = await reply.json() as { executionRunId: string; agentRunId?: string; sessionId: string; humanToken?: string } & RunPolicy
          if (!Object.hasOwn(toolPolicy, run.kind) || !allows(run, operation, args) || !uuid.test(run.executionRunId) || (!['resume-controller', 'business'].includes(run.kind) && !uuid.test(run.agentRunId ?? '')) || typeof run.sessionId !== 'string' || !run.sessionId || run.sessionId.length > 128 || closed.has(run.agentRunId ?? input.session) || controller.signal.aborted) return
          let runController = runControllers.get(run.agentRunId ?? input.session)
          if (!runController) { runController = new AbortController(); runControllers.set(run.agentRunId ?? input.session, runController) }
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
