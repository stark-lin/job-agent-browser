import { createToolRegistry } from '../../shared/tools/registry'
import { toolError, toolFail, type ToolErrorCode } from '../../shared/tools/errors'
import type { RegisteredTool, ToolCaller, ToolScopePolicy } from '../../shared/tools/tool.types'
import type { AuditedCapabilities } from '../tools/capabilities'
import { createMCPClientPool } from './client-pool'
import type { ClientHooks, MCPClient } from './client'
import { createMCPProvider } from './provider'
import { parseMCPConfiguration, type MCPConfiguration, type MCPServerConfig } from './server-config'

interface ServerStatus { id: string; state: 'disabled' | 'connecting' | 'ready' | 'degraded' | 'disconnected'; rejected: number; error?: ToolErrorCode }
interface Session { config: MCPServerConfig; controller: AbortController; dirty: boolean; refresh?: Promise<void> }
interface Dependencies {
  configuration(): MCPConfiguration
  capabilities: AuditedCapabilities
  native: RegisteredTool[]
  recoverAudit(): void
  clientFactory?: (config: MCPServerConfig, hooks: ClientHooks) => MCPClient
}
/** Main-owned composition. No SDK types, registry mutations or arbitrary policy enter Renderer. */
export function createToolRuntime(deps: Dependencies) {
  const registry = createToolRegistry(), sessions = new Map<string, Session>(), statuses = new Map<string, ServerStatus>()
  const connecting = new Map<string, Promise<void>>()
  let disposed = false, started: Promise<void> | undefined, disposal: Promise<void> | undefined, configurationError: ToolErrorCode | null = null
  let configurations: MCPServerConfig[] = []
  for (const native of deps.native) registry.register(native)
  const pool = createMCPClientPool({
    closed(id) {
      registry.unregisterServer(id)
      sessions.get(id)?.controller.abort()
      if (!disposed) statuses.set(id, { id, state: 'disconnected', rejected: 0, error: 'TOOL_UNAVAILABLE' })
    },
    changed(id) {
      // Revoke immediately; a refresh cannot leave stale tools available while discovery waits.
      registry.unregisterServer(id)
      void refresh(id)
    }
  }, deps.clientFactory)
  function refresh(id: string): Promise<void> {
    const session = sessions.get(id)
    if (disposed || !session || session.controller.signal.aborted) return Promise.resolve()
    session.dirty = true
    if (session.refresh) return session.refresh
    session.refresh = (async () => {
      do {
        session.dirty = false
        registry.unregisterServer(id)
        try {
          const result = await createMCPProvider(session.config, pool.get(id), deps.capabilities).discover(session.controller.signal)
          if (disposed || session.controller.signal.aborted || sessions.get(id) !== session) return
          if (!session.dirty) {
            registry.replaceServer(id, result.tools)
            statuses.set(id, { id, state: result.rejected.length ? 'degraded' : 'ready', rejected: result.rejected.length,
              ...(result.rejected.length ? { error: result.rejected[0].error } : {}) })
          }
        } catch (error) {
          if (!disposed && !session.controller.signal.aborted) statuses.set(id, { id, state: 'degraded', rejected: 0, error: toolError(error).code })
          return
        }
      } while (session.dirty && !disposed && !session.controller.signal.aborted)
    })().finally(() => { session.refresh = undefined })
    return session.refresh
  }
  function connect(config: MCPServerConfig, reset = false): Promise<void> {
    if (connecting.has(config.id)) return connecting.get(config.id)!
    const pending = (async () => {
      if (disposed) toolFail('TOOL_UNAVAILABLE')
      if (reset) {
        sessions.get(config.id)?.controller.abort(); registry.unregisterServer(config.id)
        await pool.disconnect(config.id)
        if (disposed) return
      }
      const session: Session = { config, controller: new AbortController(), dirty: false }
      sessions.set(config.id, session)
      statuses.set(config.id, { id: config.id, state: 'connecting', rejected: 0 })
      try { await pool.connect(config); await refresh(config.id) }
      catch (error) {
        if (!disposed) statuses.set(config.id, { id: config.id, state: 'disconnected', rejected: 0, error: toolError(error).code })
      }
    })().finally(() => connecting.delete(config.id))
    connecting.set(config.id, pending)
    return pending
  }
  return {
    start(): Promise<void> {
      if (!started) started = (async () => {
        if (disposed) return
        try {
          deps.recoverAudit()
          configurations = parseMCPConfiguration(deps.configuration()).servers
          if (disposed) return
          for (const config of configurations) if (!config.enabled) statuses.set(config.id, { id: config.id, state: 'disabled', rejected: 0 })
          await Promise.all(configurations.filter(config => config.enabled).map(config => connect(config)))
        } catch (error) { configurationError = toolError(error).code }
      })()
      return started
    },
    scope(policy: ToolScopePolicy, caller: ToolCaller) {
      if (disposed) toolFail('TOOL_UNAVAILABLE')
      if (policy.maxRisk && !['READ', 'COMPUTE'].includes(policy.maxRisk)) toolFail('TOOL_FORBIDDEN')
      return registry.scope(policy, caller)
    },
    status() { return { configurationError, servers: [...statuses.values()].map(status => ({ ...status })) } },
    reconnect(id: string) {
      const config = configurations.find(candidate => candidate.id === id && candidate.enabled)
      if (!config || disposed) toolFail('TOOL_UNAVAILABLE')
      return connect(config, true)
    },
    async disconnect(id: string) { sessions.get(id)?.controller.abort(); registry.unregisterServer(id); await pool.disconnect(id) },
    dispose(): Promise<void> {
      if (!disposal) {
        disposed = true
        registry.dispose()
        for (const session of sessions.values()) session.controller.abort()
        disposal = (async () => {
          await Promise.all([deps.capabilities.dispose(), pool.dispose()])
          await Promise.allSettled([...connecting.values(), ...[...sessions.values()].flatMap(session => session.refresh ? [session.refresh] : [])])
        })()
      }
      return disposal
    }
  }
}
export type ToolRuntime = ReturnType<typeof createToolRuntime>
