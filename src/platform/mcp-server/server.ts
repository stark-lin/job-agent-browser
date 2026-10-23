import { Server } from '@modelcontextprotocol/server'
import type { ToolRegistry } from '../../shared/tools/registry'
import type { ToolScopePolicy } from '../../shared/tools/tool.types'
import { toolError } from '../../shared/tools/errors'
import { mcpResult, mcpTool } from './tool-adapter'

/** Transport-only bridge. The policy and registry are supplied by the composition root. */
export function createMCPServer(registry: ToolRegistry, policy: ToolScopePolicy, signal: AbortSignal) {
  const server = new Server({ name: 'job-agent-browser', version: '0.1.0' }, { capabilities: { tools: {} } })
  const visible = registry.scope(policy, { agentId: 'codex', signal })
  const active = new Set<Promise<unknown>>()
  server.setRequestHandler('tools/list', async () => ({ tools: visible.list().map(mcpTool) }))
  server.setRequestHandler('tools/call', async (request, context) => {
    const scope = registry.scope(policy, { agentId: 'codex', signal: AbortSignal.any([signal, context.mcpReq.signal]) })
    const pending = scope.execute(request.params.name, request.params.arguments ?? {})
    active.add(pending)
    try { return mcpResult(await pending) }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: toolError(error).code }] } }
    finally { active.delete(pending); scope.dispose() }
  })
  server.onerror = () => {} // Raw protocol/process details never enter public errors or stdout.
  return { server, async dispose() { visible.dispose(); await Promise.allSettled([...active]); await server.close() } }
}
