import { Server } from '@modelcontextprotocol/server'
import type { ToolRegistry } from '../../shared/tools/registry'
import type { ToolScopePolicy } from '../../shared/tools/tool.types'
import { toolError, toolFail } from '../../shared/tools/errors'
import { mcpResult, mcpTool } from './tool-adapter'
import { mcpCaller } from './caller'
import { createRunGuardManager, type TrustedRunContext } from './run-guard'

/** Protocol execution boundary; neither Agents nor Domain own execution guards. */
export function createMCPServer(registry: ToolRegistry, policy: ToolScopePolicy, signal: AbortSignal, caller?: string,
  authorize?: (name: string, input: unknown, metadata: unknown) => Promise<boolean>,
  runAuthorization?: { authorize(name: string, input: unknown, metadata: unknown): Promise<TrustedRunContext | undefined>; onClosed(listener: (id: string) => Promise<void>): void }) {
  const agentId = mcpCaller(caller), guards = createRunGuardManager()
  runAuthorization?.onClosed(id => guards.close(id))
  const server = new Server({ name: 'job-agent-browser', version: '0.1.0' }, { capabilities: { tools: {} } })
  const visible = registry.scope(policy, { agentId, signal })
  const active = new Set<Promise<unknown>>()
  server.setRequestHandler('tools/list', async () => ({ tools: visible.list().map(mcpTool) }))
  server.setRequestHandler('tools/call', async (request, context) => {
    const pending = (async () => {
      const { name, _meta: metadata } = request.params, input = request.params.arguments ?? {}
      const run = await runAuthorization?.authorize(name, input, metadata)
      if (runAuthorization && !run) toolFail('TOOL_FORBIDDEN')
      if (authorize && !await authorize(name, input, metadata)) toolFail('TOOL_FORBIDDEN')
      const scope = registry.scope(policy, { agentId, runId: run?.generationRunId, signal: AbortSignal.any([signal, context.mcpReq.signal, ...(run ? [run.signal] : [])]) })
      try {
        if (!run || run.kind === 'resume-controller') return mcpResult(await scope.execute(name, input))
        const descriptor = scope.get(name)
        if (!descriptor) toolFail('TOOL_FORBIDDEN')
        const args = scope.prepareInput(name, input)
        const result = await guards.forRun(run).execute(descriptor, args, context.mcpReq.signal, () => scope.execute(name, args))
        const output = result.error ? { isError: true, content: [{ type: 'text' as const, text: result.error.code }] } : mcpResult(result.output!)
        return { ...output, _meta: { jabRunGuard: result.guard } }
      } finally { scope.dispose() }
    })()
    active.add(pending)
    try { return await pending }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: toolError(error).code }] } }
    finally { active.delete(pending) }
  })
  server.onerror = () => {} // Raw protocol/process details never enter public errors or stdout.
  return { server, async dispose() { visible.dispose(); await Promise.allSettled([...active]); await guards.dispose(); await server.close() } }
}
