import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/** Old SQL can refer to these functions during schema upgrades, before V22 removes its callers. */
export function registerLegacyMigrationFunctions(db: DatabaseSync): () => void {
  let active = true
  db.function('audit_uuid', () => active ? randomUUID() : '')
  db.function('audit_now', () => active ? new Date().toISOString() : '')
  db.function('audit_context', () => '')
  db.function('capability_audit_allowed', () => 0)
  return () => { active = false }
}
