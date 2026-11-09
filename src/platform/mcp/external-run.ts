import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ToolError, toolFail, toolErrorCodes } from '../../shared/tools/errors'
import type { TrustedRunContext } from '../mcp-server/run-guard'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** One actual MCP server connection owns this private control channel. UUIDs are not credentials. */
export function createExternalRun(directory: string) {
  let route: { port: number; token: string } | undefined, secret: string | undefined
  let channel: AbortController | undefined, current: TrustedRunContext | undefined, controller: AbortController | undefined
  let lastId: string | undefined, closing: Promise<void> | undefined, connecting: Promise<void> | undefined
  let closed = false
  let drain: (id: string) => Promise<void> = async () => {}
  async function post(path: string, body: object, signal = AbortSignal.timeout(5000)) {
    if (!route) toolFail('TOOL_UNAVAILABLE')
    try {
      const reply = await fetch(`http://127.0.0.1:${route.port}${path}`, { method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${route.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!reply.ok) {
        const value = await reply.json().catch(() => ({})) as { error?: string }
        throw new ToolError(reply.status === 403 ? 'TOOL_FORBIDDEN' : toolErrorCodes.find(code => code === value.error) ?? 'TOOL_UNAVAILABLE')
      }
      return reply
    } catch (error) { if (error instanceof ToolError) throw error; toolFail('TOOL_UNAVAILABLE') }
  }
  async function connect() {
    if (closed) toolFail('TOOL_UNAVAILABLE')
    if (secret) return
    return connecting ??= (async () => {
      const connection = new AbortController(), timeout = setTimeout(() => connection.abort(), 5000)
      channel = connection
      try {
        route = JSON.parse(await readFile(join(directory, 'run-runtime', 'control.json'), 'utf8'))
        if (!route || !Number.isInteger(route.port) || route.port < 1 || route.port > 65535 || !/^[a-f0-9]{64}$/.test(route.token)) toolFail('TOOL_UNAVAILABLE')
        const reply = await post('/session', { pid: process.pid }, connection.signal)
        const reader = reply.body!.getReader(), decoder = new TextDecoder()
        let buffer = ''
        async function line() {
          while (!buffer.includes('\n')) {
            const chunk = await reader.read(); if (chunk.done) throw new Error()
            buffer += decoder.decode(chunk.value, { stream: true }); if (buffer.length > 4096) throw new Error()
          }
          const end = buffer.indexOf('\n'), value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); return value
        }
        const first = await line()
        if (typeof first.session !== 'string' || !/^[a-f0-9]{64}$/.test(first.session)) toolFail('TOOL_UNAVAILABLE')
        // Only the handshake is bounded to five seconds; the response body is the live control channel.
        clearTimeout(timeout)
        secret = first.session
        connection.signal.addEventListener('abort', () => { void reader.cancel().catch(() => {}) }, { once: true })
        void (async () => {
          try {
            for (;;) {
              const event = await line()
              if (event.type === 'shutdown') {
                closed = true; if (current) await end(current.executionRunId)
                await post('/close', { session: secret }).then(r => r.body?.cancel()); channel?.abort(); return
              }
              if (event.type !== 'timeout' || event.runId !== current?.executionRunId) throw new Error()
              await end(event.runId)
            }
          } catch {
            closed = true
            if (current) await end(current.executionRunId).catch(() => {})
            await post('/close', { session: secret }).then(r => r.body?.cancel()).catch(() => {})
          }
        })()
      } catch (error) { connection.abort(); if (error instanceof ToolError) throw error; toolFail('TOOL_UNAVAILABLE') }
      finally { clearTimeout(timeout) }
    })().finally(() => { connecting = undefined })
  }
  async function end(id: string) {
    if (!current) { if (id === lastId) return; toolFail('TOOL_FORBIDDEN') }
    if (current.executionRunId !== id) toolFail('TOOL_FORBIDDEN')
    return closing ??= (async () => {
      controller!.abort(); await drain(id)
      const reply = await post('/end', { session: secret, runId: id }); await reply.body?.cancel()
      lastId = id; current = undefined; closing = undefined
    })()
  }
  return {
    async attach() { try { await connect() } catch (error) { if (!(error instanceof ToolError) || error.code !== 'TOOL_UNAVAILABLE') throw error } },
    onClosed(listener: typeof drain) { drain = listener },
    async begin() {
      await connect()
      if (current || closing) toolFail('TOOL_BUSY')
      // Reserve locally before the network await as tools/call requests may arrive concurrently.
      const reply = await post('/begin', { session: secret }), value = await reply.json() as { runId: string }
      if (closed) { await post('/end', { session: secret, runId: value.runId }).then(r => r.body?.cancel()); toolFail('TOOL_UNAVAILABLE') }
      if (!uuid.test(value.runId)) toolFail('TOOL_UNAVAILABLE')
      controller = new AbortController()
      current = { executionRunId: value.runId, sessionId: secret!, signal: controller.signal }
      return { runId: value.runId }
    },
    authorize(id: unknown) {
      if (closed || !current || current.executionRunId !== id || controller?.signal.aborted) toolFail('TOOL_FORBIDDEN')
      return current
    },
    end,
    async close() {
      closed = true; await connecting?.catch(() => {})
      if (current) await end(current.executionRunId).catch(() => {})
      if (secret) await post('/close', { session: secret }).then(r => r.body?.cancel()).catch(() => {})
      channel?.abort()
    }
  }
}
export type ExternalRun = ReturnType<typeof createExternalRun>
