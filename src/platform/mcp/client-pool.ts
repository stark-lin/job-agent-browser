import { ToolError, toolFail } from '../../shared/tools/errors'
import { createMCPClient, type ClientHooks, type MCPClient } from './client'
import type { MCPServerConfig } from './server-config'

interface Entry { client: MCPClient; controller: AbortController; promise: Promise<void>; config: string }
export function createMCPClientPool(hooks: { closed(id: string): void; changed(id: string): void },
  factory: (config: MCPServerConfig, hooks: ClientHooks) => MCPClient = createMCPClient) {
  const entries = new Map<string, Entry>()
  let disposed = false, disposal: Promise<void> | undefined
  async function disconnect(id: string) {
    const entry = entries.get(id)
    if (!entry) return
    entries.delete(id); entry.controller.abort(); hooks.closed(id)
    await Promise.allSettled([entry.promise, entry.client.close()])
  }
  return {
    connect(config: MCPServerConfig): Promise<void> {
      if (disposed) return Promise.reject(new ToolError('TOOL_UNAVAILABLE'))
      const previous = entries.get(config.id), key = JSON.stringify(config)
      if (previous) {
        if (previous.config !== key) toolFail('TOOL_CONFLICT')
        return previous.promise
      }
      const controller = new AbortController()
      let entry: Entry
      const client = factory(config, {
        closed() { if (entries.get(config.id) === entry) { entries.delete(config.id); hooks.closed(config.id) } },
        changed() { if (entries.get(config.id) === entry) hooks.changed(config.id) }
      })
      entry = { client, controller, config: key, promise: Promise.resolve() }
      entries.set(config.id, entry)
      entry.promise = (async () => {
        try { await client.connect(controller.signal); if (disposed || entries.get(config.id) !== entry) toolFail('TOOL_CANCELLED') }
        catch (error) {
          if (entries.get(config.id) === entry) { entries.delete(config.id); hooks.closed(config.id) }
          await client.close(); throw error
        }
      })()
      return entry.promise
    },
    get(id: string): MCPClient { const entry = entries.get(id); if (!entry) toolFail('TOOL_UNAVAILABLE'); return entry.client },
    disconnect,
    dispose() { if (!disposal) { disposed = true; disposal = Promise.all([...entries.keys()].map(disconnect)).then(() => {}) } return disposal }
  }
}
