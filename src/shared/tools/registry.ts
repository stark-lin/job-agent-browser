import { ToolError, toolFail } from './errors'
import { permitted, validateDescriptor, validatePolicy } from './policy'
import { frozenCopy } from './immutable'
import type { RegisteredTool, ToolCaller, ToolDescriptor, ToolScope, ToolScopePolicy } from './tool.types'

interface Entry { tool: RegisteredTool; revoked: AbortController }
export function createToolRegistry() {
  const entries = new Map<string, Entry>()
  function prepare(tool: RegisteredTool): Entry {
    validateDescriptor(tool.descriptor)
    const descriptor = frozenCopy(tool.descriptor)
    return { tool: { descriptor, execute: tool.execute }, revoked: new AbortController() }
  }
  function unregister(name: string) {
    const previous = entries.get(name)
    entries.delete(name)
    previous?.revoked.abort(new ToolError('TOOL_UNAVAILABLE'))
  }
  return {
    register(tool: RegisteredTool) {
      const entry = prepare(tool)
      if (entries.has(entry.tool.descriptor.name)) toolFail('TOOL_CONFLICT')
      entries.set(entry.tool.descriptor.name, entry)
    },
    unregister,
    unregisterServer(serverId: string) {
      for (const [name, entry] of entries) if (entry.tool.descriptor.source.type === 'mcp' && entry.tool.descriptor.source.serverId === serverId) unregister(name)
    },
    replaceServer(serverId: string, tools: RegisteredTool[]) {
      const next = tools.map(prepare), names = new Set<string>()
      for (const entry of next) {
        const { name, source } = entry.tool.descriptor, previous = entries.get(name)?.tool.descriptor.source
        if (source.type !== 'mcp' || source.serverId !== serverId) toolFail('TOOL_INVALID_CONFIG')
        if (names.has(name) || (previous && (previous.type !== 'mcp' || previous.serverId !== serverId))) toolFail('TOOL_CONFLICT')
        names.add(name)
      }
      // Validate the complete batch before revoking the previous generation.
      for (const [name, entry] of entries) if (entry.tool.descriptor.source.type === 'mcp' && entry.tool.descriptor.source.serverId === serverId) unregister(name)
      for (const entry of next) entries.set(entry.tool.descriptor.name, entry)
    },
    get(name: string): ToolDescriptor | null { return entries.get(name)?.tool.descriptor ?? null },
    list(): ToolDescriptor[] { return [...entries.values()].map(entry => entry.tool.descriptor).sort((a, b) => a.name.localeCompare(b.name)) },
    scope(input: ToolScopePolicy, caller: ToolCaller): ToolScope {
      const policy = validatePolicy(input), stopped = new AbortController()
      if (!caller || !/^[a-z][a-z0-9_.-]{0,63}$/.test(caller.agentId) ||
        (caller.runId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(caller.runId)) ||
        !(caller.signal instanceof AbortSignal)) toolFail('TOOL_INVALID_CONFIG')
      const identity = { agentId: caller.agentId, runId: caller.runId, signal: caller.signal }
      const snapshot = new Map([...entries].filter(([, entry]) => permitted(entry.tool.descriptor, policy)))
      const live = (name: string) => {
        const entry = snapshot.get(name)
        return !stopped.signal.aborted && !identity.signal.aborted && entry && entries.get(name) === entry && !entry.revoked.signal.aborted ? entry : null
      }
      return {
        get: name => live(name)?.tool.descriptor ?? null,
        list: () => [...snapshot.keys()].flatMap(name => live(name) ? [live(name)!.tool.descriptor] : []).sort((a, b) => a.name.localeCompare(b.name)),
        async execute(name, args) {
          if (stopped.signal.aborted || identity.signal.aborted) toolFail('TOOL_CANCELLED')
          const entry = live(name)
          if (!entry) toolFail(snapshot.has(name) ? 'TOOL_UNAVAILABLE' : 'TOOL_FORBIDDEN')
          return entry.tool.execute(args, { ...identity, signal: AbortSignal.any([identity.signal, stopped.signal, entry.revoked.signal]) })
        },
        dispose() { stopped.abort() }
      }
    },
    dispose() { for (const name of [...entries.keys()]) unregister(name) }
  }
}
export type ToolRegistry = ReturnType<typeof createToolRegistry>
