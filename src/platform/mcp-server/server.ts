import { resumeAgentTools, resumeAgentLifecycle } from '../../shared/agent/resume-policy'
import { scopeTools, scopeDirectory } from './scope-tools'
import { parseHumanInput } from '../mcp/human-requests'
import type { HumanAskResult } from '../../shared/human'
import { Server } from '@modelcontextprotocol/server'
import type { ToolRegistry } from '../../shared/tools/registry'
import type { ToolScopePolicy } from '../../shared/tools/tool.types'
import { toolError, toolFail } from '../../shared/tools/errors'
import type { ExternalRun } from '../mcp/external-run'
import { mcpResult, mcpTool, controlTools, humanTool } from './tool-adapter'
import { mcpCaller } from './caller'
import { createRunGuardManager, type TrustedRunContext } from './run-guard'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Security gateway: execution protocol fields never enter business schemas or Domain. */
export function createMCPServer(registry: ToolRegistry, policy: ToolScopePolicy, signal: AbortSignal, caller?: string,
  authorize?: (name: string, input: unknown, metadata: unknown) => Promise<boolean>,
  runAuthorization?: { authorize(name: string, input: unknown, metadata: unknown): Promise<TrustedRunContext | undefined>; onClosed(listener: (id: string, final: boolean) => Promise<void>): void },
  external?: ExternalRun, settleOperations: () => Promise<void> = async () => {},
  humanAsk?: (run: TrustedRunContext, input: unknown, signal: AbortSignal) => Promise<HumanAskResult>) {
  const agentId = mcpCaller(caller), guards = createRunGuardManager()
  runAuthorization?.onClosed(async (id, final) => { await (final ? guards.close(id) : guards.settle(id)); await settleOperations() })
  external?.onClosed(async id => { await guards.close(id); await settleOperations() })
  const server = new Server({ name: 'job-agent-browser', version: '0.1.0' }, { capabilities: { tools: {} } })
  const visible = registry.scope(policy, { agentId, signal })
  const directories = runAuthorization ? scopeTools(visible.list()) : []
  const active = new Set<Promise<unknown>>()
  server.setRequestHandler('tools/list', async () => ({ tools: [
    ...visible.list().map(tool => mcpTool(tool, !runAuthorization)), ...directories.map(tool => mcpTool(tool)), mcpTool(humanTool, !runAuthorization), ...(!runAuthorization ? controlTools : [])
  ] }))
  server.setRequestHandler('tools/call', async (request, context) => {
    const pending = (async () => {
      const { name, _meta: metadata } = request.params
      let input: unknown = request.params.arguments ?? {}
      if (!runAuthorization && ['run.begin', 'run.end'].includes(name)) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) toolFail('TOOL_INVALID_INPUT')
        const args = input as Record<string, unknown>
        if (name === 'run.begin') {
          if (Object.keys(args).length) toolFail('TOOL_INVALID_INPUT')
          if (!external) toolFail('TOOL_UNAVAILABLE')
          const created = await external.begin()
          if (context.mcpReq.signal.aborted || signal.aborted) { await external.end(created.runId); toolFail('TOOL_CANCELLED') }
          return mcpResult({ content: [], structuredContent: created })
        }
        if (Object.keys(args).join(',') !== 'runId' || typeof args.runId !== 'string' || !uuid.test(args.runId)) toolFail('TOOL_INVALID_INPUT')
        if (!external) toolFail('TOOL_UNAVAILABLE')
        await external.end(args.runId)
        return mcpResult({ content: [], structuredContent: {} })
      }
      let run: TrustedRunContext | undefined
      if (runAuthorization) {
        run = await runAuthorization.authorize(name, input, metadata)
        if (!run) toolFail('TOOL_FORBIDDEN')
      } else {
        if (!input || typeof input !== 'object' || Array.isArray(input)) toolFail('TOOL_INVALID_INPUT')
        const { executionRunId, ...business } = input as Record<string, unknown>
        if (typeof executionRunId !== 'string' || !uuid.test(executionRunId)) toolFail('TOOL_FORBIDDEN')
        if (!external) toolFail('TOOL_UNAVAILABLE')
        run = external.authorize(executionRunId); input = business
      }
      const controlSignal = AbortSignal.any([signal, context.mcpReq.signal, run.signal])
      if (name.startsWith('scope.')) {
        if (!directories.some(tool => tool.name === name)) toolFail('TOOL_FORBIDDEN')
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) toolFail('TOOL_INVALID_INPUT')
        const catalog = visible.list().filter(tool => run.kind === 'resume' ? resumeAgentTools.includes(tool.name as typeof resumeAgentTools[number]) : run.kind === 'resume-controller' ? resumeAgentLifecycle.includes(tool.name as typeof resumeAgentLifecycle[number]) : true)
        const directory = scopeDirectory(name, catalog)
        if (!directory.tools.length) toolFail('TOOL_FORBIDDEN')
        return mcpResult({ content: [], structuredContent: directory })
      }
      if (name === 'human.ask') {
        const question = parseHumanInput(input)
        if (!humanAsk) toolFail('TOOL_UNAVAILABLE')
        const result = await humanAsk(run, question, controlSignal)
        controlSignal.throwIfAborted()
        return mcpResult({ content: [], structuredContent: result })
      }
      if (authorize && !await authorize(name, input, metadata)) toolFail('TOOL_FORBIDDEN')
      const scope = registry.scope(policy, { agentId, runId: run.generationRunId,
        signal: AbortSignal.any([signal, context.mcpReq.signal, run.signal]) })
      const cancel = () => { if (!runAuthorization) void external?.end(run.executionRunId).catch(() => {}) }
      context.mcpReq.signal.addEventListener('abort', cancel, { once: true })
      if (context.mcpReq.signal.aborted) cancel()
      try {
        // Trusted controller grants are lifecycle orchestration within the same global occupancy.
        if (run.kind === 'resume-controller') return mcpResult(await scope.execute(name, input))
        const descriptor = scope.get(name)
        if (!descriptor) toolFail('TOOL_FORBIDDEN')
        const args = scope.prepareInput(name, input)
        const result = await guards.forRun(run).execute(descriptor, args, context.mcpReq.signal, () => scope.execute(name, args))
        const output = result.error ? { isError: true, content: [{ type: 'text' as const, text: result.error.code }] } : mcpResult(result.output!)
        return { ...output, _meta: { jabRunGuard: result.guard } }
      } finally { context.mcpReq.signal.removeEventListener('abort', cancel); scope.dispose() }
    })()
    active.add(pending)
    try { return await pending }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: toolError(error).code }] } }
    finally { active.delete(pending) }
  })
  server.onerror = () => {} // Raw protocol/process details never enter public errors or stdout.
  return { server, async dispose() {
    visible.dispose()
    await external?.close()
    await Promise.allSettled([...active]); await guards.dispose(); await settleOperations(); await server.close()
  } }
}
