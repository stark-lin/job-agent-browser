import type { DatabaseSync } from 'node:sqlite'
import type { References } from '../../domain/common/ports'
import { entityTables } from './entity-tables'

/** Hard-deleted and never-existing entities share the same current-state reference. */
export function references(db: DatabaseSync): References {
  return { resolve(type, id) {
    const exists = type === 'artifact_fact'
      ? db.prepare('SELECT 1 FROM artifact_facts WHERE json_array(artifact_id,block_id,fact_id)=?').get(id)
      : db.prepare(`SELECT 1 FROM ${entityTables[type]} WHERE id=?`).get(id)
    return { type, id, status: exists ? 'ACTIVE' : 'MISSING' }
  } }
}
