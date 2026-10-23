import { randomUUID } from 'node:crypto'
import { ToolError, toolError, toolFail } from '../../shared/tools/errors'
import { validateDescriptor } from '../../shared/tools/policy'
import { frozenCopy } from '../../shared/tools/immutable'
import type { RegisteredTool, ToolCaller, ToolDescriptor, ToolExecutionContext, ToolOutput } from '../../shared/tools/tool.types'
import type { CapabilityAudit, CapabilityAuditContext } from './audit.types'
import { compileSchema, jsonCopy, limits, toolOutput } from './schema'

type Operation = (input: unknown, context: ToolExecutionContext) => ToolOutput | Promise<ToolOutput>
interface Options {
  timeoutMs?: number
  target?(input: unknown): CapabilityAuditContext['target']
}
/** Tools bind these already audited capabilities; adapters never assemble audit records. */
export function createAuditedCapabilities(audit: CapabilityAudit, defaults: { timeoutMs?: number; maxActive?: number } = {}) {
  const active = new Map<AbortController, Promise<void>>()
  let disposed = false
  function bind(mode: 'read' | 'write', input: ToolDescriptor, operation: Operation, options: Options = {}): RegisteredTool {
    if (input.mode !== mode) toolFail('TOOL_INVALID_CONFIG')
    validateDescriptor(input)
    const schema = compileSchema(input.inputSchema, true), output = input.outputSchema ? compileSchema(input.outputSchema) : undefined
    const descriptor: ToolDescriptor = frozenCopy({ ...input, inputSchema: schema.schema, ...(output ? { outputSchema: output.schema } : {}) })
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? 30000
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) toolFail('TOOL_INVALID_CONFIG')
    return {
      descriptor,
      async execute(value: unknown, caller: ToolCaller) {
        if (disposed) toolFail('TOOL_UNAVAILABLE')
        if (caller.signal.aborted) toolFail('TOOL_CANCELLED')
        if (active.size >= (defaults.maxActive ?? 16)) toolFail('TOOL_BUSY')
        const args = jsonCopy(value, limits.input, 'TOOL_INVALID_INPUT')
        if (!schema.validate(args)) toolFail('TOOL_INVALID_INPUT')
        const invocationId = randomUUID(), controller = new AbortController()
        const context: CapabilityAuditContext = { invocationId, agentId: caller.agentId, runId: caller.runId, tool: descriptor, target: options.target?.(args) }
        const began = performance.now()
        let timedOut = false, settle!: () => void
        const done = new Promise<void>(resolve => { settle = resolve })
        active.set(controller, done)
        let timer: ReturnType<typeof setTimeout> | undefined, onAbort: (() => void) | undefined
        try {
          try { audit.start(context) } catch { toolFail('TOOL_AUDIT_UNAVAILABLE') }
          let result: ToolOutput | undefined, failure: ToolError | undefined
          try {
            const signal = AbortSignal.any([caller.signal, controller.signal])
            timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
            const aborted = new Promise<never>((_resolve, reject) => {
              onAbort = () => reject(timedOut ? new ToolError('TOOL_TIMEOUT') : signal.reason instanceof ToolError ? signal.reason : new ToolError('TOOL_CANCELLED'))
              signal.addEventListener('abort', onAbort, { once: true })
              if (signal.aborted) onAbort()
            })
            try {
              signal.throwIfAborted()
              const pending = Promise.resolve().then(() => { signal.throwIfAborted(); return operation(args, { ...caller, invocationId, signal }) })
              result = toolOutput(await Promise.race([pending, aborted]), output?.validate)
              if (signal.aborted) toolFail(timedOut ? 'TOOL_TIMEOUT' : 'TOOL_CANCELLED')
            } finally { if (onAbort) signal.removeEventListener('abort', onAbort) }
          } catch (error) {
            failure = timedOut ? new ToolError('TOOL_TIMEOUT') : caller.signal.aborted && caller.signal.reason instanceof ToolError ? caller.signal.reason :
              caller.signal.aborted || controller.signal.aborted ? new ToolError('TOOL_CANCELLED') : toolError(error)
          }
          try { audit.finish(context, Math.max(0, Math.round(performance.now() - began)), failure?.code ?? null) } catch { toolFail('TOOL_AUDIT_UNAVAILABLE') }
          if (failure) throw failure
          return result!
        } finally { clearTimeout(timer); active.delete(controller); controller.abort(); settle() }
      }
    }
  }
  return {
    read: (descriptor: ToolDescriptor, operation: Operation, options?: Options) => bind('read', descriptor, operation, options),
    write: (descriptor: ToolDescriptor, operation: Operation, options?: Options) => bind('write', descriptor, operation, options),
    async dispose() {
      disposed = true
      const pending = [...active.values()]
      for (const controller of active.keys()) controller.abort()
      await Promise.all(pending)
    }
  }
}
export type AuditedCapabilities = ReturnType<typeof createAuditedCapabilities>
