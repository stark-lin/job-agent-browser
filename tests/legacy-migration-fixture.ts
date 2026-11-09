import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { Transactions } from '../src/platform/database/transactions'

/** Historical-schema fixture only; production has no audit context or writer. */
export class LegacyTransactions extends Transactions {
  constructor(private readonly legacyDB: DatabaseSync) { super(legacyDB) }
  override write<T>(operation: () => T): T {
    const context: Record<string, string> = { active: 'SUCCESS', event: 'LEGACY_FIXTURE', source: 'STARTUP', actorId: 'fixture', requestId: randomUUID(), transactionId: randomUUID() }
    this.legacyDB.function('audit_uuid', () => randomUUID())
    this.legacyDB.function('audit_now', () => new Date().toISOString())
    this.legacyDB.function('audit_context', key => typeof key === 'string' && this.legacyDB.isTransaction ? context[key] ?? '' : '')
    try { return super.write(operation) } finally { this.legacyDB.function('audit_context', () => '') }
  }
}
