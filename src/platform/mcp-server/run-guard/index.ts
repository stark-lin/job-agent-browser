import type { RunGuardSnapshot, GuardReason } from '../../../shared/agent/run-guard'
import { guardNextAction } from '../../../shared/agent/run-guard'
import { ToolError, toolError, toolFail } from '../../../shared/tools/errors'
import type { JsonValue, ToolDescriptor, ToolOutput } from '../../../shared/tools/tool.types'
import { callDigest } from '../../mcp/call-fingerprint'
import { confirmedArchive, progressKey } from './policies'
import { ReadProgress } from './read-progress'

export interface TrustedRunContext { executionRunId: string; humanToken?: string; agentRunId?: string; sessionId: string; kind?: 'ask' | 'resume' | 'resume-controller' | 'business'; generationRunId?: string; signal: AbortSignal }
export interface GuardedResult { output?: ToolOutput; error?: ToolError; guard: RunGuardSnapshot }
const preflightErrors = new Set(['TOOL_INVALID_INPUT', 'TOOL_FORBIDDEN', 'TOOL_NOT_FOUND', 'TOOL_BUSY', 'TOOL_CONFLICT'])
class RunGuard {
  private state: RunGuardSnapshot
  private seen = new Set<string>()
  private reads = new ReadProgress()
  private violations = new Map<string, number>()
  private closed = false
  private tail: Promise<unknown> = Promise.resolve()
  constructor(public context: TrustedRunContext) {
    this.state = { executionRunId: context.executionRunId, status: 'ACTIVE', calls: 0, executedCalls: 0, noProgress: 0, rejections: 0,
      progress: 0, executed: false, effectAlreadyConfirmed: false, effects: [] }
  }
  snapshot() { return structuredClone(this.state) }
  private block(reason: GuardReason) { this.state.status = 'BLOCKED'; this.state.reason = reason; this.state.level = undefined; this.state.nextAction = undefined }
  private unchanged() {
    if (++this.state.noProgress >= 4) this.block('NO_PROGRESS_LOOP')
    else if (this.state.noProgress >= 2) {
      this.state.level = this.state.noProgress === 2 ? 'warning' : 'recovery'
      this.state.nextAction = guardNextAction
    }
  }
  private advanced() { this.state.progress++; this.state.noProgress = 0; this.state.level = undefined; this.state.nextAction = undefined }
  private progress(key: string) {
    if (this.seen.has(key)) this.unchanged()
    else { this.seen.add(key); this.advanced() }
  }
  private reject(key: string, reason: 'DUPLICATE_WRITE' | 'REVERSED_WRITE'): ToolError {
    this.state.reason = reason; this.state.rejections++; this.state.effectAlreadyConfirmed = true
    const count = (this.violations.get(`${key}:${reason}`) ?? 0) + 1
    this.violations.set(`${key}:${reason}`, count); this.unchanged()
    if (count >= 2) this.block('REPEATED_VIOLATION')
    return new ToolError(this.state.status === 'BLOCKED' ? 'TOOL_GUARD_TERMINATED' : reason === 'DUPLICATE_WRITE' ? 'TOOL_GUARD_DUPLICATE' : 'TOOL_GUARD_CONFLICT')
  }
  execute(tool: ToolDescriptor, args: JsonValue, signal: AbortSignal, operation: () => Promise<ToolOutput>): Promise<GuardedResult> {
    const runSignal = this.context.signal
    const pending = this.tail.then(async (): Promise<GuardedResult> => {
      if (this.closed || runSignal.aborted || signal.aborted) toolFail('TOOL_CANCELLED')
      this.state.executed = false; this.state.effectAlreadyConfirmed = false
      if (this.state.status === 'BLOCKED') return { error: new ToolError('TOOL_GUARD_TERMINATED'), guard: this.snapshot() }
      this.state.reason = undefined
      if (++this.state.calls > 256) {
        this.block('CALL_BUDGET_EXCEEDED'); this.state.rejections++
        return { error: new ToolError('TOOL_GUARD_TERMINATED'), guard: this.snapshot() }
      }
      const key = callDigest([tool.name, args])
      if (tool.name === 'job.set_archived') {
        const a = args as { id: string; archived: boolean }, previous = this.state.effects.find(e => e.id === a.id)
        if (previous) return { error: this.reject(key, previous.archived === a.archived ? 'DUPLICATE_WRITE' : 'REVERSED_WRITE'), guard: this.snapshot() }
      }
      this.state.executed = true; this.state.executedCalls++
      try {
        const output = await operation()
        const effect = tool.name === 'job.set_archived' ? confirmedArchive(args, output.structuredContent) : undefined
        if (effect) { this.state.effects.push(effect); this.progress(`effect:${effect.id}:${effect.archived}`) }
        else {
          if (tool.mode === 'read') {
            if (this.reads.observe(tool, args, output)) this.advanced(); else this.unchanged()
          } else {
            const progress = progressKey(tool, args, output.structuredContent)
            if (progress) this.progress(progress)
            else if (tool.name === 'resume.rewrite_bullet' || this.state.level === 'recovery') this.unchanged()
          }
        }
        return { output, guard: this.snapshot() }
      } catch (error) {
        const failure = toolError(error)
        if (tool.mode === 'write' && !preflightErrors.has(failure.code)) this.block('WRITE_OUTCOME_UNKNOWN')
        else if (tool.mode === 'read' || this.state.level === 'recovery') this.unchanged()
        else {
          const failureKey = `failure:${key}:${failure.code}`
          if (this.seen.has(failureKey)) this.unchanged(); else this.seen.add(failureKey)
        }
        return { error: failure, guard: this.snapshot() }
      }
    })
    this.tail = pending.catch(() => {})
    return pending
  }
  async settle() { await this.tail }
  async close() { this.closed = true; await this.tail; this.seen.clear(); this.reads.clear(); this.violations.clear(); this.state.effects = [] }
}
export function createRunGuardManager() {
  const runs = new Map<string, RunGuard>()
  return {
    forRun(context: TrustedRunContext) {
      if (context.signal.aborted) toolFail('TOOL_CANCELLED')
      let guard = runs.get(context.executionRunId)
      if (guard && guard.context.sessionId !== context.sessionId) toolFail('TOOL_FORBIDDEN')
      if (guard) guard.context = context
      if (!guard) { guard = new RunGuard(context); runs.set(context.executionRunId, guard) }
      return guard
    },
    async settle(id: string) { await runs.get(id)?.settle() },
    async close(id: string) { const guard = runs.get(id); if (guard) { await guard.close(); if (runs.get(id) === guard) runs.delete(id) } },
    async dispose() { await Promise.all([...runs.values()].map(g => g.close())); runs.clear() }
  }
}
