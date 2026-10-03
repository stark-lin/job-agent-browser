import type { AuditEntry, AuditReader, References, TargetType } from '../../domain/common/ports'
import * as v from '../../domain/common/validation'
import { fail } from '../../domain/common/errors'
import type { UnitOfWork } from '../../domain/common/ports'
import type { SQLInputValue } from 'node:sqlite'
import { entityTables } from './migrations/audit-triggers'
import type { Store } from './repositories/store'

const targetType = v.choice(Object.keys(entityTables) as TargetType[])
const filter = v.object({
  ...v.pageFields, targetType: v.optional(v.nullable(targetType), null), targetId: v.optional(v.nullable(v.text(120, 1)), null),
  requestId: v.optionalId, transactionId: v.optionalId, status: v.optional(v.nullable(v.choice(['SUCCESS', 'FAILURE'])), null),
  from: v.optional(v.nullable(v.timestamp), null), to: v.optional(v.nullable(v.timestamp), null)
})

export function auditReader(store: Store, tx: UnitOfWork): AuditReader {
  return { list(input) { return tx.read(() => {
    const args = filter(input)
    if (args.from && args.to && args.from > args.to) fail('INVALID_INPUT')
    const where: string[] = [], values: SQLInputValue[] = []
    for (const [column, value] of [['target_type', args.targetType], ['target_id', args.targetId], ['request_id', args.requestId],
      ['transaction_id', args.transactionId], ['status', args.status]] as const) {
      if (value !== null) { where.push(`${column}=?`); values.push(value) }
    }
    if (args.from) { where.push('timestamp>=?'); values.push(args.from) }
    if (args.to) { where.push('timestamp<=?'); values.push(args.to) }
    return store.list<AuditEntry>('audit_logs', where.join(' AND ') || '1=1', values, 'sequence DESC', args.limit, args.offset)
  }) } }
}

export function references(store: Store): References {
  return { resolve(type, id) {
    if (store.db.prepare(`SELECT id FROM ${entityTables[type]} WHERE id=?`).get(id)) return { type, id, status: 'ACTIVE', deletedAt: null }
    const deletion = store.db.prepare("SELECT timestamp FROM audit_logs WHERE target_type=? AND target_id=? AND action='DELETE' AND status='SUCCESS' ORDER BY sequence DESC LIMIT 1").get(type, id)
    // Missing without a successful deletion is corruption, never a made-up tombstone.
    if (!deletion) fail('STORAGE_UNAVAILABLE')
    return { type, id, status: 'DELETED', deletedAt: String(deletion.timestamp) }
  } }
}
