/** Content-free diagnostics, never credentials or resumable execution state. */
export const guardReasons = ['DUPLICATE_WRITE', 'REVERSED_WRITE', 'NO_PROGRESS_LOOP', 'CALL_BUDGET_EXCEEDED', 'REPEATED_VIOLATION', 'WRITE_OUTCOME_UNKNOWN'] as const
export type GuardReason = typeof guardReasons[number]
export interface RunGuardSnapshot {
  chatRunId: string
  status: 'ACTIVE' | 'BLOCKED'
  calls: number
  executedCalls: number
  noProgress: number
  rejections: number
  progress: number
  executed: boolean
  effectAlreadyConfirmed: boolean
  reason?: GuardReason
  effects: { id: string; archived: boolean }[]
}
export function parseRunGuard(value: unknown): RunGuardSnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const v = value as Record<string, unknown>
  if (typeof v.chatRunId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.chatRunId)
    || !['ACTIVE', 'BLOCKED'].includes(String(v.status)) || typeof v.executed !== 'boolean' || typeof v.effectAlreadyConfirmed !== 'boolean'
    || ['calls', 'executedCalls', 'noProgress', 'rejections', 'progress'].some(k => !Number.isSafeInteger(v[k]) || Number(v[k]) < 0 || Number(v[k]) > 100000)
    || v.reason !== undefined && !guardReasons.includes(v.reason as GuardReason) || !Array.isArray(v.effects) || v.effects.length > 256) return
  const effects: RunGuardSnapshot['effects'] = []
  for (const effect of v.effects) {
    if (!effect || typeof effect !== 'object' || typeof effect.id !== 'string' || !/^[0-9a-f-]{36}$/.test(effect.id) || typeof effect.archived !== 'boolean') return
    effects.push({ id: effect.id, archived: effect.archived })
  }
  return { chatRunId: v.chatRunId, status: v.status as RunGuardSnapshot['status'], calls: Number(v.calls), executedCalls: Number(v.executedCalls),
    noProgress: Number(v.noProgress), rejections: Number(v.rejections), progress: Number(v.progress), executed: v.executed,
    effectAlreadyConfirmed: v.effectAlreadyConfirmed, ...(v.reason ? { reason: v.reason as GuardReason } : {}), effects }
}
