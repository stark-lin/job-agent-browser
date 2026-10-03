import type { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { initialSchema } from './schema'
import { auditTriggers } from './audit-triggers'

export interface Migration { version: number; sql: string }
export const migrations: readonly Migration[] = [{ version: 1, sql: initialSchema + auditTriggers() }]

/** Startup only, before repositories are constructed. Never silently repair or reset a database. */
export function migrate(db: DatabaseSync, steps: readonly Migration[] = migrations): void {
  db.exec('BEGIN IMMEDIATE')
  try {
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
