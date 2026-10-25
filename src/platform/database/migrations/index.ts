import type { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { initialSchema } from './schema'
import { auditTriggers } from './audit-triggers'
import { aiAuditMigration } from './ai-audit'
import { capabilityAuditMigration } from './capability-audit'
import { runtimeLeaseMigration } from './runtime-leases'
import { operationReceiptMigration } from './operation-receipts'
import { chatMigration } from './chat'
import { profileWriteMigration } from './profile-writes'
import { profileIntroductionMigration } from './profile-introduction'

export interface Migration { version: number; sql: string }
export const migrations: readonly Migration[] = [{ version: 1, sql: initialSchema + auditTriggers() }, { version: 2, sql: aiAuditMigration },
  { version: 3, sql: capabilityAuditMigration }, { version: 4, sql: runtimeLeaseMigration }, { version: 5, sql: operationReceiptMigration }, { version: 6, sql: chatMigration },
  { version: 7, sql: profileIntroductionMigration }, { version: 8, sql: profileWriteMigration }]

// A new incompatible schema generation. Inspect before any journal/schema writes.
export const DATABASE_GENERATION = 0x4a415632
export function assertDatabaseGeneration(db: DatabaseSync): void {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
  if (tables.length && db.prepare('PRAGMA application_id').get()?.application_id !== DATABASE_GENERATION) {
    throw new Error('INCOMPATIBLE_DATABASE_GENERATION: Resume Agent V1 requires a new userData directory; the existing database was not changed.')
  }
}

/** Startup only, before repositories are constructed. Never silently repair or reset a database. */
export function migrate(db: DatabaseSync, steps: readonly Migration[] = migrations): void {
  assertDatabaseGeneration(db)
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`PRAGMA application_id=${DATABASE_GENERATION}`)
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL) STRICT')
    const applied = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all()
    if (applied.length > steps.length) throw new Error('UNSUPPORTED_DATABASE_VERSION')
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index], checksum = createHash('sha256').update(step.sql).digest('hex')
      if (step.version !== index + 1) throw new Error('INVALID_MIGRATION_SEQUENCE')
      if (applied[index]) {
        if (applied[index].version !== step.version || applied[index].checksum !== checksum) throw new Error('MIGRATION_MISMATCH')
      } else {
        db.exec(step.sql)
        db.prepare('INSERT INTO schema_migrations(version, checksum) VALUES (?, ?)').run(step.version, checksum)
      }
    }
    db.exec('COMMIT')
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error }
}
