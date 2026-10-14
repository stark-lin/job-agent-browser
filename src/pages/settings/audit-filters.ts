import type { AuditFilter, AuditTargetType } from '../../domain/common/ports'

export const auditTargets = ['company', 'job', 'job_source', 'job_event', 'profile', 'profile_item', 'fact', 'generation_run', 'artifact', 'artifact_fact', 'ai_request'] as const satisfies readonly AuditTargetType[]
export interface AuditDraft {
  targetType: AuditTargetType | ''; status: 'SUCCESS' | 'FAILURE' | ''
  targetId: string; requestId: string; transactionId: string; from: string; to: string
}
export const emptyAuditDraft: AuditDraft = { targetType: '', status: '', targetId: '', requestId: '', transactionId: '', from: '', to: '' }
export type AuditFilterError = 'targetId' | 'requestId' | 'transactionId' | 'from' | 'to' | 'range'

/** Convert local datetime fields to the canonical UTC timestamps accepted by IPC. */
export function parseAuditDraft(draft: AuditDraft): { ok: true; filter: AuditFilter } | { ok: false; field: AuditFilterError } {
  const filter: AuditFilter = {}
  if (draft.targetType) filter.targetType = draft.targetType
  if (draft.status) filter.status = draft.status
  const targetId = draft.targetId.trim()
  if (targetId.length > 120 || targetId.includes('\0')) return { ok: false, field: 'targetId' }
  if (targetId) filter.targetId = targetId
  for (const field of ['requestId', 'transactionId'] as const) {
    const id = draft[field].trim()
    if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) return { ok: false, field }
    if (id) filter[field] = id
  }
  for (const field of ['from', 'to'] as const) {
    if (!draft[field]) continue
    const date = new Date(draft[field])
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(draft[field]) || !Number.isFinite(date.getTime())) return { ok: false, field }
    const [year, month, day, hour, minute] = draft[field].split(/[-T:]/).map(Number)
    if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return { ok: false, field }
    const timestamp = date.toISOString()
    if (timestamp.length !== 24) return { ok: false, field }
    filter[field] = timestamp
  }
  if (filter.from && filter.to && filter.from > filter.to) return { ok: false, field: 'range' }
  return { ok: true, filter }
}
